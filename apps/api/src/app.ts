import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  analyzeResiliency,
  azureServiceCatalog,
  diagramSchema,
  estimateDiagramCost,
  generateIacBundle,
  resiliencyTargetSchema,
  validateArchitecture,
} from '@aar/shared';
import { AiGenerationError, generateSpec, generateSpecFromImage } from './ai/openai.js';
import {
  buildImageSystemPrompt,
  buildImageUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  summarizeDiagram,
} from './ai/prompt.js';
import { formatArchitecturesForPrompt, retrieveArchitectures } from './ai/knowledge.js';
import { getLearnGrounding, searchLearnDocs } from './ai/learnGrounding.js';
import { groundResiliency } from './ai/resiliency.js';
import { reviewArchitecture } from './ai/review.js';
import { adviseArchitecture } from './ai/advisor.js';
import {
  createFoundryModelDiscovery,
  type ReviewModelList,
} from './ai/foundryModels.js';
import { specToDiagram } from './ai/spec.js';
import type { AppConfig } from './config.js';

const resiliencyRequestSchema = z.object({
  diagram: diagramSchema,
  target: resiliencyTargetSchema.optional(),
  /** Refresh SLA figures from Microsoft Learn instead of using the baseline table. */
  grounded: z.boolean().default(false),
});

const reviewRequestSchema = z.object({
  diagram: diagramSchema,
  /** Pull Microsoft Learn references into the review. */
  grounded: z.boolean().default(false),
  /** Foundry deployment selected from GET /api/review/models. */
  model: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/).optional(),
});

const adviseRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  diagram: diagramSchema,
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .max(10)
    .default([]),
});

const generateRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  current: diagramSchema.optional(),
  mode: z.enum(['faithful', 'bestPractice']).default('bestPractice'),
});

const generateImageRequestSchema = z.object({
  /** A PNG or JPEG data URL of the diagram to transcribe. */
  image: z
    .string()
    .regex(
      /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/,
      'Image must be a PNG or JPEG data URL.',
    )
    .max(14_000_000, 'Image is too large.'),
  prompt: z.string().max(4000).optional(),
  mode: z.enum(['faithful', 'bestPractice']).default('faithful'),
});

/**
 * Builds the Fastify application. Kept separate from the listen() call so tests
 * can exercise routes via `app.inject()` without binding a port.
 */
export interface AppDependencies {
  reviewModels?: { getModels: () => Promise<ReviewModelList> };
}

export async function buildApp(
  config: AppConfig,
  dependencies: AppDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
  });

  const reviewModels = config.azureOpenAI
    ? dependencies.reviewModels ?? createFoundryModelDiscovery(config.azureOpenAI)
    : null;

  // Liveness/readiness probe used by Container Apps and docker-compose.
  app.get('/healthz', async () => ({
    status: 'ok',
    aiConfigured: config.azureOpenAI !== null,
  }));

  // The Azure service catalog, served to the web app as a single source of truth.
  app.get('/api/catalog', async () => ({ services: azureServiceCatalog }));

  // Review-compatible model deployments. Foundry discovery is best-effort and
  // always retains the configured default deployment as a fallback.
  app.get('/api/review/models', async (_request, reply) => {
    if (!reviewModels) {
      return reply.code(503).send({
        error: 'ai_not_configured',
        message: 'AI review is not configured.',
      });
    }
    return reply.send(await reviewModels.getModels());
  });

  // Microsoft Learn documentation search (grounding source). Best-effort.
  app.post('/api/docs-search', async (request, reply) => {
    const body = z.object({ query: z.string().min(1).max(1000) }).safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: body.error.issues[0]?.message ?? 'Invalid request body.',
      });
    }
    if (!config.learn.enabled) return reply.send({ results: [] });
    const results = await searchLearnDocs(body.data.query, config.learn.endpoint);
    return reply.send({ results });
  });

  // Deterministic Well-Architected Framework validation (no model call).
  app.post('/api/validate', async (request, reply) => {
    const parsed = diagramSchema.safeParse((request.body as { diagram?: unknown })?.diagram ?? request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid diagram.',
      });
    }
    return reply.send({ report: validateArchitecture(parsed.data) });
  });

  // Deterministic monthly cost estimate (representative pricing, no model call).
  app.post('/api/cost', async (request, reply) => {
    const parsed = diagramSchema.safeParse((request.body as { diagram?: unknown })?.diagram ?? request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid diagram.',
      });
    }
    return reply.send({ cost: estimateDiagramCost(parsed.data) });
  });

  // Composite SLA / RPO / RTO analysis. Always returns the deterministic
  // baseline; `grounded` additionally refreshes figures from Microsoft Learn.
  app.post('/api/resiliency', async (request, reply) => {
    const parsed = resiliencyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid diagram.',
      });
    }
    const { diagram, target, grounded } = parsed.data;

    if (!grounded) {
      return reply.send({ report: analyzeResiliency(diagram, { target }) });
    }
    if (!config.azureOpenAI) {
      return reply.send({
        report: analyzeResiliency(diagram, { target }),
        groundingError:
          'Learn grounding needs a configured model. Set AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_MODEL on the API.',
      });
    }

    // Grounding is best-effort: a failure must never cost the caller the baseline.
    try {
      const { profiles, citations } = await groundResiliency(
        config.azureOpenAI,
        config.learn,
        diagram,
      );
      return reply.send({
        report: analyzeResiliency(diagram, { target, overrides: profiles }),
        profiles,
        citations,
      });
    } catch (err) {
      request.log.warn(err, 'resiliency grounding failed');
      return reply.send({
        report: analyzeResiliency(diagram, { target }),
        groundingError:
          err instanceof AiGenerationError ? err.message : 'Could not refresh figures from Microsoft Learn.',
      });
    }
  });

  // AI architecture review: applies the waf-architecture-review methodology to
  // the deterministic WAF + resiliency + cost analysis. Requires a model (503
  // when unconfigured, like /api/generate); grounding failure is soft.
  app.post('/api/review', async (request, reply) => {
    if (!config.azureOpenAI) {
      return reply.code(503).send({
        error: 'ai_not_configured',
        message:
          'AI review is not configured. Set AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_MODEL on the API, then provide AZURE_FOUNDRY_API_KEY or use Entra ID by leaving the key blank.',
      });
    }
    const parsed = reviewRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid diagram.',
      });
    }
    if (parsed.data.diagram.nodes.length === 0) {
      return reply.code(400).send({
        error: 'empty_diagram',
        message: 'Add some services before requesting a review.',
      });
    }

    try {
      const availableModels = await reviewModels!.getModels();
      const selectedModel = parsed.data.model ?? availableModels.defaultDeployment;
      if (!availableModels.models.some((model) => model.deploymentName === selectedModel)) {
        return reply.code(400).send({
          error: 'invalid_model',
          message: 'The selected model is not available for architecture review.',
        });
      }
      const result = await reviewArchitecture(
        { ...config.azureOpenAI, deployment: selectedModel },
        config.learn,
        parsed.data.diagram,
        parsed.data.grounded,
      );
      return reply.send(result);
    } catch (err) {
      if (err instanceof AiGenerationError) {
        return reply.code(err.status).send({ error: 'ai_error', message: err.message });
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'internal_error', message: 'Review failed.' });
    }
  });

  // Contextual architecture Q&A. The browser owns the bounded conversation
  // history; every turn is grounded in the latest diagram and never mutates it.
  app.post('/api/advise', async (request, reply) => {
    if (!config.azureOpenAI) {
      return reply.code(503).send({
        error: 'ai_not_configured',
        message:
          'AI advice is not configured. Set AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_MODEL on the API, then provide AZURE_FOUNDRY_API_KEY or use Entra ID by leaving the key blank.',
      });
    }
    const parsed = adviseRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body.',
      });
    }

    try {
      const result = await adviseArchitecture(
        config.azureOpenAI,
        config.learn,
        parsed.data.diagram,
        parsed.data.message,
        parsed.data.history,
      );
      return reply.send(result);
    } catch (err) {
      if (err instanceof AiGenerationError) {
        return reply.code(err.status).send({ error: 'ai_error', message: err.message });
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'internal_error', message: 'Architecture advice failed.' });
    }
  });

  // Deterministic IaC generation from catalog metadata (no model call).
  app.post('/api/iac', async (request, reply) => {
    const parsed = z.object({
      diagram: diagramSchema,
      target: z.enum(['bicep', 'terraform']),
    }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body.',
      });
    }
    return reply.send({ bundle: generateIacBundle(parsed.data.diagram, parsed.data.target) });
  });

  // Prompt-to-diagram (ADR-0010). Returns a fully validated Diagram, or 503 when
  // Azure OpenAI is not configured (bring-your-own — ADR-0003).
  app.post('/api/generate', async (request, reply) => {
    if (!config.azureOpenAI) {
      return reply.code(503).send({
        error: 'ai_not_configured',
        message:
          'AI generation is not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT, then provide AZURE_OPENAI_API_KEY or use Entra ID by leaving the key blank.',
      });
    }

    const parsed = generateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body.',
      });
    }

    const { prompt, current, mode } = parsed.data;
    const architectures = retrieveArchitectures(prompt);
    const kbGrounding = formatArchitecturesForPrompt(architectures);
    // Best-effort Microsoft Learn grounding; never blocks generation (soft-fail).
    const learn = await getLearnGrounding(config.learn, prompt, architectures);
    const grounding = learn ? `${kbGrounding}\n\n${learn.text}` : kbGrounding;
    const systemPrompt = buildSystemPrompt(grounding, mode);
    const userPrompt = buildUserPrompt(
      prompt,
      current ? summarizeDiagram(current) : undefined,
    );

    try {
      const spec = await generateSpec(config.azureOpenAI, systemPrompt, userPrompt);
      const diagram = specToDiagram(spec);
      return reply.send({ diagram, citations: learn?.citations ?? [] });
    } catch (err) {
      if (err instanceof AiGenerationError) {
        return reply.code(err.status).send({ error: 'ai_error', message: err.message });
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'internal_error', message: 'Generation failed.' });
    }
  });

  // Image-to-diagram: transcribe an uploaded diagram image (larger body than JSON routes).
  app.post('/api/generate/image', { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    if (!config.azureOpenAI) {
      return reply.code(503).send({
        error: 'ai_not_configured',
        message:
          'AI generation is not configured. Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT, then provide AZURE_OPENAI_API_KEY or use Entra ID by leaving the key blank.',
      });
    }

    const parsed = generateImageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Invalid request body.',
      });
    }

    const { image, prompt, mode } = parsed.data;

    // Best-effort guard: block only when the active model is known to lack vision.
    if (reviewModels) {
      try {
        const list = await reviewModels.getModels();
        const active = list.models.find((m) => m.deploymentName === list.defaultDeployment);
        if (active?.supportsVision === false) {
          return reply.code(422).send({
            error: 'model_not_vision_capable',
            message:
              `The configured model "${active.modelName ?? active.deploymentName}" does not accept ` +
              'image input. Deploy a vision-capable model such as gpt-4o and set it as the default.',
          });
        }
      } catch {
        // Discovery is best-effort; fall through and let the model refuse if it must.
      }
    }

    const systemPrompt = buildImageSystemPrompt(mode);
    const userPrompt = buildImageUserPrompt(prompt);

    try {
      const spec = await generateSpecFromImage(config.azureOpenAI, systemPrompt, userPrompt, [image]);
      const diagram = specToDiagram(spec);
      return reply.send({ diagram, citations: [] });
    } catch (err) {
      if (err instanceof AiGenerationError) {
        return reply.code(err.status).send({ error: 'ai_error', message: err.message });
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'internal_error', message: 'Generation failed.' });
    }
  });

  return app;
}
