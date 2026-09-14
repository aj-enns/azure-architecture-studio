import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import type { AzureOpenAIConfig } from '../config.js';

const MANAGEMENT_SCOPE = 'https://management.azure.com/.default';
const DEPLOYMENTS_API_VERSION = '2024-10-01';
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

export interface ReviewModel {
  deploymentName: string;
  modelName?: string;
  modelVersion?: string;
  isDefault: boolean;
  /** True/false when the model is known; undefined when the model name is unknown. */
  supportsVision?: boolean;
}

/** Model families that accept image input on Azure OpenAI / Foundry. */
const VISION_MODEL_PREFIXES = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-4-turbo',
  'gpt-4-vision',
  'gpt-5',
  'o1',
  'o3',
  'o4-mini',
];
/** Text-only variants that would otherwise match a vision prefix. */
const NON_VISION_MODELS = new Set(['o1-mini', 'o3-mini']);

/** Best-effort check of whether a model name accepts image input. */
export function isVisionCapableModelName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized || NON_VISION_MODELS.has(normalized)) return false;
  return VISION_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export interface ReviewModelList {
  models: ReviewModel[];
  defaultDeployment: string;
  warning?: string;
}

interface ArmDeployment {
  name?: unknown;
  properties?: {
    provisioningState?: unknown;
    capabilities?: Record<string, unknown>;
    model?: { name?: unknown; version?: unknown };
  };
}

interface ArmDeploymentPage {
  value?: unknown;
  nextLink?: unknown;
}

export interface FoundryModelDiscoveryDependencies {
  fetch?: typeof fetch;
  getManagementToken?: () => Promise<string>;
  now?: () => number;
  cacheTtlMs?: number;
}

function capabilityIsTrue(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.toLowerCase() === 'true');
}

function toReviewModel(deployment: ArmDeployment, defaultDeployment: string): ReviewModel | null {
  if (typeof deployment.name !== 'string' || deployment.name.length === 0) return null;
  const properties = deployment.properties;
  if (properties?.provisioningState !== 'Succeeded') return null;

  const capabilities = properties.capabilities ?? {};
  const supportsChat = capabilityIsTrue(capabilities.chatCompletion);
  // ARM currently exposes JSON object support rather than a distinct strict
  // json_schema flag. This is the closest dynamic compatibility signal.
  const supportsStructuredJson =
    capabilityIsTrue(capabilities.jsonSchemaResponse) ||
    capabilityIsTrue(capabilities.jsonObjectResponse);
  if (!supportsChat || !supportsStructuredJson) return null;

  return {
    deploymentName: deployment.name,
    ...(typeof properties.model?.name === 'string' ? { modelName: properties.model.name } : {}),
    ...(typeof properties.model?.version === 'string'
      ? { modelVersion: properties.model.version }
      : {}),
    isDefault: deployment.name === defaultDeployment,
    ...(typeof properties.model?.name === 'string'
      ? { supportsVision: isVisionCapableModelName(properties.model.name) }
      : {}),
  };
}

function fallbackModel(config: AzureOpenAIConfig): ReviewModel {
  return { deploymentName: config.deployment, isDefault: true };
}

function fallbackList(config: AzureOpenAIConfig, warning: string): ReviewModelList {
  return {
    models: [fallbackModel(config)],
    defaultDeployment: config.deployment,
    warning,
  };
}

/**
 * Creates a cached Foundry deployment reader. Discovery is best-effort: the
 * configured deployment always remains available when ARM cannot be queried.
 */
export function createFoundryModelDiscovery(
  config: AzureOpenAIConfig,
  dependencies: FoundryModelDiscoveryDependencies = {},
): { getModels: () => Promise<ReviewModelList> } {
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const cacheTtlMs = dependencies.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const defaultTokenProvider = dependencies.getManagementToken
    ? null
    : getBearerTokenProvider(new DefaultAzureCredential(), MANAGEMENT_SCOPE);
  const getManagementToken = dependencies.getManagementToken ?? defaultTokenProvider!;
  let cache: { value: ReviewModelList; expiresAt: number } | null = null;
  let inFlight: Promise<ReviewModelList> | null = null;

  async function loadModels(): Promise<ReviewModelList> {
    if (config.provider !== 'foundry') {
      return fallbackList(
        config,
        'Live model discovery is available only for Microsoft Foundry endpoints.',
      );
    }
    if (!config.resourceId) {
      return fallbackList(
        config,
        'Set AZURE_FOUNDRY_RESOURCE_ID to discover other compatible model deployments.',
      );
    }

    try {
      const token = await getManagementToken();
      let url: string | null =
        `https://management.azure.com${config.resourceId}/deployments` +
        `?api-version=${DEPLOYMENTS_API_VERSION}`;
      const deployments: ArmDeployment[] = [];

      while (url) {
        const response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          throw new Error(`Azure Resource Manager returned ${response.status}.`);
        }
        const page = (await response.json()) as ArmDeploymentPage;
        if (Array.isArray(page.value)) deployments.push(...(page.value as ArmDeployment[]));
        if (typeof page.nextLink === 'string' && page.nextLink.length > 0) {
          const nextUrl = new URL(page.nextLink);
          if (nextUrl.origin !== 'https://management.azure.com') {
            throw new Error('Azure Resource Manager returned an invalid pagination link.');
          }
          url = nextUrl.toString();
        } else {
          url = null;
        }
      }

      const models = deployments
        .map((deployment) => toReviewModel(deployment, config.deployment))
        .filter((model): model is ReviewModel => model !== null)
        .sort((left, right) => left.deploymentName.localeCompare(right.deploymentName));

      if (!models.some((model) => model.deploymentName === config.deployment)) {
        models.unshift(fallbackModel(config));
      }

      return {
        models,
        defaultDeployment: config.deployment,
        ...(models.length === 1 && models[0]?.deploymentName === config.deployment
          ? { warning: 'No additional review-compatible Foundry deployments were discovered.' }
          : {}),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      if (cache) {
        return {
          ...cache.value,
          warning: `Could not refresh Foundry deployments; using the last successful list. ${reason}`,
        };
      }
      return fallbackList(
        config,
        `Could not discover Foundry deployments; using the configured default. ${reason}`,
      );
    }
  }

  return {
    async getModels(): Promise<ReviewModelList> {
      if (cache && cache.expiresAt > now()) return cache.value;
      if (inFlight) return inFlight;
      inFlight = loadModels().then((value) => {
        if (!value.warning || value.models.length > 1) {
          cache = { value, expiresAt: now() + cacheTtlMs };
        }
        return value;
      });
      try {
        return await inFlight;
      } finally {
        inFlight = null;
      }
    },
  };
}
