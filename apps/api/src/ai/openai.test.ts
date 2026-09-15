import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBearerTokenProvider } from '@azure/identity';
import { generateJson } from './openai.js';
import type { AzureOpenAIConfig } from '../config.js';

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn(),
  getBearerTokenProvider: vi.fn((_credential, scope: string) => async () => `token:${scope}`),
}));

const config: AzureOpenAIConfig = {
  provider: 'foundry',
  endpoint: 'https://example.services.ai.azure.com',
  deployment: 'test-model',
  apiVersion: '2024-05-01-preview',
  auth: { kind: 'entra' },
};
const schema = { name: 'test', jsonSchema: { type: 'object' } };

afterEach(() => vi.unstubAllGlobals());

describe('inference authentication', () => {
  it('keeps Foundry and Azure OpenAI token audiences separate across requests', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const openAIConfig: AzureOpenAIConfig = {
      ...config,
      provider: 'azureOpenAI',
      endpoint: 'https://example.openai.azure.com',
    };

    for (const requestConfig of [config, openAIConfig, config]) {
      await generateJson(requestConfig, 'system', 'user', schema);
    }

    expect(getBearerTokenProvider).toHaveBeenCalledTimes(2);
    for (const [index, scope] of [
      'https://ai.azure.com/.default',
      'https://cognitiveservices.azure.com/.default',
      'https://ai.azure.com/.default',
    ].entries()) {
      expect(fetchMock.mock.calls[index][1].headers.Authorization).toBe(`Bearer token:${scope}`);
    }
    expect(fetchMock.mock.calls[0][0]).toContain('/models/chat/completions');
    expect(fetchMock.mock.calls[1][0]).toContain('/openai/deployments/test-model/chat/completions');
  });

  it('preserves API-key authentication', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })),
      );
    vi.stubGlobal('fetch', fetchMock);
    await generateJson(
      { ...config, auth: { kind: 'apiKey', apiKey: 'test-key' } },
      'system',
      'user',
      schema,
    );
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'api-key': 'test-key',
    });
  });

  it.each([
    [config, 'Cognitive Services User'],
    [{ ...config, endpoint: 'https://example.openai.azure.com' }, 'Cognitive Services OpenAI User'],
  ])('reports the role required by the endpoint', async (requestConfig, role) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(generateJson(requestConfig, 'system', 'user', schema)).rejects.toThrow(
      `"${role}"`,
    );
  });
});
