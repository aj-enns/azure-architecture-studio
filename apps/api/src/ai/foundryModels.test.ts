import { describe, expect, it, vi } from 'vitest';
import { createFoundryModelDiscovery, isVisionCapableModelName } from './foundryModels.js';
import type { AzureOpenAIConfig } from '../config.js';

const config: AzureOpenAIConfig = {
  provider: 'foundry',
  endpoint: 'https://example.services.ai.azure.com',
  deployment: 'gpt-default',
  resourceId:
    '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/foundry',
  apiVersion: '2024-05-01-preview',
  auth: { kind: 'entra' },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('vision capability detection', () => {
  it('recognizes vision-capable model families', () => {
    for (const name of [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4.1',
      'gpt-4-turbo',
      'gpt-5',
      'o1',
      'o4-mini',
    ]) {
      expect(isVisionCapableModelName(name)).toBe(true);
    }
  });

  it('rejects text-only models', () => {
    for (const name of [
      'gpt-35-turbo',
      'gpt-4',
      'o1-mini',
      'o3-mini',
      'text-embedding-3-large',
      '',
    ]) {
      expect(isVisionCapableModelName(name)).toBe(false);
    }
  });
});

describe('Foundry model discovery', () => {
  it('paginates and returns only succeeded chat deployments with JSON support', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              name: 'gpt-review',
              properties: {
                provisioningState: 'Succeeded',
                capabilities: { chatCompletion: 'true', jsonObjectResponse: 'true' },
                model: { name: 'gpt-4.1', version: '2025-04-14' },
              },
            },
            {
              name: 'embedding',
              properties: {
                provisioningState: 'Succeeded',
                capabilities: { embeddings: 'true' },
              },
            },
          ],
          nextLink: 'https://management.azure.com/next-page',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              name: 'still-creating',
              properties: {
                provisioningState: 'Creating',
                capabilities: { chatCompletion: 'true', jsonObjectResponse: 'true' },
              },
            },
          ],
        }),
      );
    const getManagementToken = vi.fn().mockResolvedValue('arm-token');
    const discovery = createFoundryModelDiscovery(config, {
      fetch: fetchMock,
      getManagementToken,
    });

    const result = await discovery.getModels();

    expect(result.models).toEqual([
      { deploymentName: 'gpt-default', isDefault: true },
      {
        deploymentName: 'gpt-review',
        modelName: 'gpt-4.1',
        modelVersion: '2025-04-14',
        isDefault: false,
        supportsVision: true,
      },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`${config.resourceId}/deployments?api-version=2024-10-01`),
      { headers: { Authorization: 'Bearer arm-token' } },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://management.azure.com/next-page', {
      headers: { Authorization: 'Bearer arm-token' },
    });
  });

  it('caches successful discovery results', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        value: [
          {
            name: 'gpt-review',
            properties: {
              provisioningState: 'Succeeded',
              capabilities: { chatCompletion: true, jsonSchemaResponse: true },
            },
          },
        ],
      }),
    );
    const discovery = createFoundryModelDiscovery(config, {
      fetch: fetchMock,
      getManagementToken: async () => 'token',
    });

    await discovery.getModels();
    await discovery.getModels();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the configured deployment when ARM discovery fails', async () => {
    const discovery = createFoundryModelDiscovery(config, {
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('network unavailable')),
      getManagementToken: async () => 'token',
    });

    const result = await discovery.getModels();

    expect(result.models).toEqual([{ deploymentName: 'gpt-default', isDefault: true }]);
    expect(result.warning).toContain('using the configured default');
  });
});
