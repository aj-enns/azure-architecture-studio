import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { azureServiceCatalog, diagramSchema } from '@aar/shared';
import { AiGenerationError, generateSpec } from './ai/openai.js';
import { buildSystemPrompt, buildUserPrompt, summarizeDiagram } from './ai/prompt.js';
import { specToDiagram } from './ai/spec.js';
import type { AppConfig } from './config.js';

const generateRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  current: diagramSchema.optional(),
});

/**
 * Builds the Fastify application. Kept separate from the listen() call so tests
 * can exercise routes via `app.inject()` without binding a port.
 */
export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
  });

  // Liveness/readiness probe used by Container Apps and docker-compose.
  app.get('/healthz', async () => ({
    status: 'ok',
    aiConfigured: config.azureOpenAI !== null,
  }));

  // The Azure service catalog, served to the web app as a single source of truth.
  app.get('/api/catalog', async () => ({ services: azureServiceCatalog }));

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

    const { prompt, current } = parsed.data;
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(
      prompt,
      current ? summarizeDiagram(current) : undefined,
    );

    try {
      const spec = await generateSpec(config.azureOpenAI, systemPrompt, userPrompt);
      const diagram = specToDiagram(spec);
      return reply.send({ diagram });
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
