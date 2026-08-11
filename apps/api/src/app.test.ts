import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

describe('api', () => {
  it('reports healthy on /healthz with AI unconfigured', async () => {
    const config = loadConfig({ PORT: '8080' } as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', aiConfigured: false });
    await app.close();
  });

  it('serves the service catalog', async () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({ method: 'GET', url: '/api/catalog' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().services)).toBe(true);
    await app.close();
  });

  it('returns 503 from /api/generate when AI is unconfigured', async () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: { prompt: 'a web app with a database' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'ai_not_configured' });
    await app.close();
  });

  it('validates the /api/generate request body when AI is configured', async () => {
    const config = loadConfig({
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'test-key',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o',
    } as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate',
      payload: { prompt: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    await app.close();
  });

  it('returns 503 from /api/generate/image when AI is unconfigured', async () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate/image',
      payload: { image: 'data:image/png;base64,iVBORw0KGgo=' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'ai_not_configured' });
    await app.close();
  });

  it('rejects a non-image data URL on /api/generate/image', async () => {
    const config = loadConfig({
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'test-key',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o',
    } as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate/image',
      payload: { image: 'https://example.com/diagram.png' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    await app.close();
  });

  it('returns 422 when the configured model cannot accept image input', async () => {
    const config = loadConfig({
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'test-key',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-35-turbo',
    } as NodeJS.ProcessEnv);
    const app = await buildApp(config, {
      reviewModels: {
        getModels: async () => ({
          models: [{ deploymentName: 'gpt-35-turbo', modelName: 'gpt-35-turbo', isDefault: true, supportsVision: false }],
          defaultDeployment: 'gpt-35-turbo',
        }),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate/image',
      payload: { image: 'data:image/png;base64,iVBORw0KGgo=' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'model_not_vision_capable' });
    await app.close();
  });

  it('treats AI as configured with keyless Entra ID auth (no API key)', async () => {
    const config = loadConfig({
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o',
    } as NodeJS.ProcessEnv);
    expect(config.azureOpenAI).not.toBeNull();
    expect(config.azureOpenAI?.auth.kind).toBe('entra');

    const app = await buildApp(config);
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.json()).toMatchObject({ status: 'ok', aiConfigured: true });
    await app.close();
  });

  it('supports Microsoft Foundry model inference configuration', () => {
    const config = loadConfig({
      AZURE_FOUNDRY_ENDPOINT: 'https://example.services.ai.azure.com',
      AZURE_FOUNDRY_MODEL: 'gpt-5-mini',
      AZURE_FOUNDRY_RESOURCE_ID:
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/foundry',
      AZURE_FOUNDRY_API_VERSION: '2024-05-01-preview',
    } as NodeJS.ProcessEnv);

    expect(config.azureOpenAI).toMatchObject({
      provider: 'foundry',
      endpoint: 'https://example.services.ai.azure.com',
      deployment: 'gpt-5-mini',
      resourceId:
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/foundry',
      apiVersion: '2024-05-01-preview',
      auth: { kind: 'entra' },
    });
  });

  it('generates a deterministic IaC bundle', async () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({
      method: 'POST',
      url: '/api/iac',
      payload: {
        target: 'bicep',
        diagram: {
          version: 1,
          metadata: { name: 'API test', region: 'eastus2' },
          nodes: [{ id: 'storage-1', serviceId: 'storage-account', position: { x: 0, y: 0 } }],
          groups: [],
          edges: [],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().bundle).toMatchObject({
      target: 'bicep',
      generatedResourceCount: 1,
    });
    await app.close();
  });

  it('rejects an invalid IaC target', async () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({
      method: 'POST',
      url: '/api/iac',
      payload: {
        target: 'arm',
        diagram: { version: 1, metadata: {}, nodes: [], groups: [], edges: [] },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    await app.close();
  });

  it('returns a baseline resiliency report without a model', async () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({
      method: 'POST',
      url: '/api/resiliency',
      payload: {
        diagram: {
          version: 1,
          metadata: { name: 'API test', region: 'eastus2' },
          nodes: [
            { id: 'plan-1', serviceId: 'app-service-plan', position: { x: 0, y: 0 } },
            { id: 'sql-1', serviceId: 'sql-database', position: { x: 0, y: 0 } },
          ],
          groups: [],
          edges: [],
        },
        target: { slaPercent: 99.99, rtoMinutes: 240, rpoMinutes: 15 },
      },
    });

    expect(res.statusCode).toBe(200);
    const report = res.json().report;
    expect(report.compositeSlaPercent).toBeLessThan(100);
    expect(report.weakestLink.serviceId).toBe('app-service-plan');
    expect(report.meetsTarget).toBe(false);
    await app.close();
  });

  it('falls back to the baseline when grounding is requested but AI is unconfigured', async () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({
      method: 'POST',
      url: '/api/resiliency',
      payload: {
        grounded: true,
        diagram: {
          version: 1,
          metadata: { name: 'API test', region: 'eastus2' },
          nodes: [{ id: 'kv-1', serviceId: 'key-vault', position: { x: 0, y: 0 } }],
          groups: [],
          edges: [],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().report.compositeSlaPercent).toBe(99.99);
    expect(res.json().groundingError).toContain('AZURE_FOUNDRY_ENDPOINT');
    await app.close();
  });

  it('rejects a resiliency request without a diagram', async () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({ method: 'POST', url: '/api/resiliency', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    await app.close();
  });

  it('returns 503 from /api/review when AI is unconfigured', async () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({
      method: 'POST',
      url: '/api/review',
      payload: {
        diagram: {
          version: 1,
          metadata: { name: 'API test', region: 'eastus2' },
          nodes: [{ id: 'n1', serviceId: 'app-service', position: { x: 0, y: 0 } }],
          groups: [],
          edges: [],
        },
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'ai_not_configured' });
    await app.close();
  });

  it('returns 503 from /api/review/models when AI is unconfigured', async () => {
    const config = loadConfig({} as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({ method: 'GET', url: '/api/review/models' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'ai_not_configured' });
    await app.close();
  });

  it('serves the configured review model when live discovery is unavailable', async () => {
    const config = loadConfig({
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o',
    } as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({ method: 'GET', url: '/api/review/models' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      models: [{ deploymentName: 'gpt-4o', isDefault: true }],
      defaultDeployment: 'gpt-4o',
    });
    await app.close();
  });

  it('rejects a review model outside the discovered compatible set', async () => {
    const config = loadConfig({
      AZURE_FOUNDRY_ENDPOINT: 'https://example.services.ai.azure.com',
      AZURE_FOUNDRY_MODEL: 'gpt-default',
    } as NodeJS.ProcessEnv);
    const app = await buildApp(config, {
      reviewModels: {
        getModels: async () => ({
          models: [{ deploymentName: 'gpt-default', isDefault: true }],
          defaultDeployment: 'gpt-default',
        }),
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/review',
      payload: {
        model: 'not-allowed',
        diagram: {
          version: 1,
          metadata: {},
          nodes: [{ id: 'n1', serviceId: 'app-service', position: { x: 0, y: 0 } }],
          groups: [],
          edges: [],
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_model' });
    await app.close();
  });

  it('rejects a review of an empty diagram when AI is configured', async () => {
    const config = loadConfig({
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_API_KEY: 'test-key',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o',
    } as NodeJS.ProcessEnv);
    const app = await buildApp(config);
    const res = await app.inject({
      method: 'POST',
      url: '/api/review',
      payload: {
        diagram: { version: 1, metadata: {}, nodes: [], groups: [], edges: [] },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'empty_diagram' });
    await app.close();
  });
});
