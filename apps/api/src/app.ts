import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  analyzeResiliency,
  armTemplateToDiagram,
  azureServiceCatalog,
  diagramSchema,
  estimateDiagramCost,
  generateIacBundle,
  resiliencyTargetSchema,
  scanRepoFiles,
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
import { createFoundryModelDiscovery, type ReviewModelList } from './ai/foundryModels.js';
import { specToDiagram } from './ai/spec.js';
import { AzureImportError, importFromResourceGraph } from './importAzure.js';
import { importFromGitHub, RepoImportError } from './importRepo.js';
import type { AppConfig, AzureOpenAIConfig } from './config.js';

const resiliencyRequestSchema = z.object({
  diagram: diagramSchema,
  target: resiliencyTargetSchema.optional(),
  /** Refresh SLA figures from Microsoft Learn instead of using the baseline table. */
  grounded: z.boolean().default(false),
});

/** Foundry deployment selected from GET /api/review/models. */
const modelSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/)
  .optional();

const reviewRequestSchema = z.object({
  diagram: diagramSchema,
  /** Pull Microsoft Learn references into the review. */
  grounded: z.boolean().default(false),
  model: modelSchema,
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
  model: modelSchema,
});

const generateRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  current: diagramSchema.optional(),
  mode: z.enum(['faithful', 'bestPractice']).default('bestPractice'),
  model: modelSchema,
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
  model: modelSchema,
});

/**
 * Builds the Fastify application. Kept separate from the listen() call so tests
 * can exercise routes via `app.inject()` without binding a port.
 */
export interface AppDependencies {
  reviewModels?: { getModels: () => Promise<ReviewModelList> };
  docsSearch?: typeof searchLearnDocs;
  importAzure?: typeof importFromResourceGraph;
  importRepo?: typeof importFromGitHub;
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
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindowMs,
  });

  const reviewModels = config.azureOpenAI
    ? (dependencies.reviewModels ?? createFoundryModelDiscovery(config.azureOpenAI))
    : null;

  /**
   * Resolves the Azure config for a request, optionally overriding the model
   * deployment with a caller-selected one. The selection is validated against
   * the discovered compatible deployments; on failure a 400 is sent and null is
   * returned. Callers must have already ensured `config.azureOpenAI` is set.
   */
  async function resolveAiConfig(
    model: string | undefined,
    reply: FastifyReply,
  ): Promise<AzureOpenAIConfig | null> {
    const base = config.azureOpenAI!;
    if (!model || model === base.deployment) return base;
    if (reviewModels) {
      const available = await reviewModels.getModels();
      if (!available.models.some((candidate) => candidate.deploymentName === model)) {
        reply.code(400).send({
          error: 'invalid_model',
          message: 'The selected model is not available.',
        });
        return null;
      }
    }
    return { ...base, deployment: model };
  }

  // Liveness/readiness probe used by Container Apps and docker-compose.
  app.get('/healthz', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    aiConfigured: config.azureOpenAI !== null,
    iacImportEnabled: config.iacImportEnabled,
    privacy: {
      mode: config.iacImportEnabled ? 'self-hosted' : 'hosted',
      aiHost: config.azureOpenAI ? new URL(config.azureOpenAI.endpoint).host : null,
      learnHost: config.learn.enabled ? new URL(config.learn.endpoint).host : null,
    },
  }));

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (
      !config.iacImportEnabled &&
      (pathname === '/api/import/repo' || pathname === '/api/import/arm')
    ) {
      return reply.code(403).send({
        error: 'import_disabled',
        message: 'IaC import is only available in self-hosted mode.',
      });
    }
  });

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
    const results = await (dependencies.docsSearch ?? searchLearnDocs)(
      body.data.query,
      config.learn.endpoint,
    );
    return reply.send({ results });
  });

  // Deterministic import of a compiled ARM/Bicep template (no model, no creds).
  app.post('/api/import/arm', async (request, reply) => {
    const body = z
      .object({
        template: z.record(z.string(), z.unknown()),
        name: z.string().max(200).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: body.error.issues[0]?.message ?? 'Invalid template.',
      });
    }
    const diagram = armTemplateToDiagram(
      body.data.template,
      body.data.name ? { name: body.data.name } : {},
    );
    if (diagram.nodes.length === 0) {
      return reply.code(400).send({
        error: 'empty_template',
        message: 'No supported Azure resources were found in the template.',
      });
    }
    return reply.send({ diagram });
  });

  // Live import of a resource group via Azure Resource Graph (needs Azure auth).
  app.post('/api/import/azure', async (request, reply) => {
    const body = z
      .object({
        subscriptionId: z.string().uuid(),
        resourceGroup: z.string().regex(/^[A-Za-z0-9._()-]{1,90}$/, 'Invalid resource group name.'),
        name: z.string().max(200).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: body.error.issues[0]?.message ?? 'Invalid request.',
      });
    }
    try {
      const diagram = await (dependencies.importAzure ?? importFromResourceGraph)(body.data);
      if (diagram.nodes.length === 0) {
        return reply.code(404).send({
          error: 'empty_resource_group',
          message: 'No supported Azure resources were found in that resource group.',
        });
      }
      return reply.send({ diagram });
    } catch (err) {
      if (err instanceof AzureImportError) {
        return reply.code(err.status).send({ error: 'azure_import_error', message: err.message });
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'internal_error', message: 'Azure import failed.' });
    }
  });

  // Deterministic import of a repository's IaC (Bicep/Terraform/ARM). Accepts
  // browser-sent files or fetches a public GitHub repo server-side.
  app.post('/api/import/repo', { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const body = z
      .object({
        files: z
          .array(
            z.object({
              path: z.string().min(1).max(1024),
              content: z.string().max(2_000_000),
            }),
          )
          .max(500)
          .optional(),
        githubUrl: z.string().url().optional(),
        name: z.string().max(200).optional(),
      })
      .refine((value) => value.files?.length || value.githubUrl, {
        message: 'Provide repository files or a githubUrl.',
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: body.error.issues[0]?.message ?? 'Invalid request.',
      });
    }
    try {
      const diagram = body.data.githubUrl
        ? await (dependencies.importRepo ?? importFromGitHub)(body.data.githubUrl)
        : scanRepoFiles(body.data.files!, body.data.name ?? 'Imported repository');
      if (diagram.nodes.length === 0) {
        return reply.code(400).send({
          error: 'empty_repository',
          message: 'No supported Bicep, Terraform, or ARM resources were found.',
        });
      }
      return reply.send({ diagram });
    } catch (err) {
      if (err instanceof RepoImportError) {
        return reply.code(err.status).send({ error: 'repo_import_error', message: err.message });
      }
      request.log.error(err);
      return reply
        .code(500)
        .send({ error: 'internal_error', message: 'Repository import failed.' });
    }
  });

  // Deterministic Well-Architected Framework validation (no model call).
  app.post('/api/validate', async (request, reply) => {
    const parsed = diagramSchema.safeParse(
      (request.body as { diagram?: unknown })?.diagram ?? request.body,
    );
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
    const parsed = diagramSchema.safeParse(
      (request.body as { diagram?: unknown })?.diagram ?? request.body,
    );
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
          err instanceof AiGenerationError
            ? err.message
            : 'Could not refresh figures from Microsoft Learn.',
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
      const aiConfig = await resolveAiConfig(parsed.data.model, reply);
      if (!aiConfig) return reply;
      const result = await adviseArchitecture(
        aiConfig,
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
      return reply
        .code(500)
        .send({ error: 'internal_error', message: 'Architecture advice failed.' });
    }
  });

  // Deterministic IaC generation from catalog metadata (no model call).
  app.post('/api/iac', async (request, reply) => {
    const parsed = z
      .object({
        diagram: diagramSchema,
        target: z.enum(['bicep', 'terraform']),
      })
      .safeParse(request.body);
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
    const userPrompt = buildUserPrompt(prompt, current ? summarizeDiagram(current) : undefined);

    try {
      const aiConfig = await resolveAiConfig(parsed.data.model, reply);
      if (!aiConfig) return reply;
      const spec = await generateSpec(aiConfig, systemPrompt, userPrompt);
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

    const { image, prompt, mode, model } = parsed.data;
    const aiConfig = await resolveAiConfig(model, reply);
    if (!aiConfig) return reply;

    // Best-effort guard: block only when the selected model is known to lack vision.
    if (reviewModels) {
      try {
        const list = await reviewModels.getModels();
        const active = list.models.find((m) => m.deploymentName === aiConfig.deployment);
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
      const spec = await generateSpecFromImage(aiConfig, systemPrompt, userPrompt, [image]);
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
