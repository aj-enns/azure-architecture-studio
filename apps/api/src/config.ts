import { z } from 'zod';

/**
 * Server configuration, parsed and validated from environment variables at
 * startup. Foundry/Azure OpenAI settings are bring-your-own (ADR-0003) and optional —
 * the server starts without them; AI routes report "not configured" instead.
 *
 * Two auth modes are supported (ADR-0011):
 * - API key: set AZURE_OPENAI_API_KEY.
 * - Keyless (Microsoft Entra ID): omit the key; the server acquires a bearer
 *   token via DefaultAzureCredential (az login locally, managed identity in
 *   Azure). The identity needs the "Cognitive Services OpenAI User" role.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Bring-your-own Microsoft Foundry model inference (optional).
  AZURE_FOUNDRY_ENDPOINT: z.string().url().optional().or(z.literal('')),
  AZURE_FOUNDRY_MODEL: z.string().optional().or(z.literal('')),
  AZURE_FOUNDRY_API_KEY: z.string().optional().or(z.literal('')),
  AZURE_FOUNDRY_API_VERSION: z.string().default('2024-05-01-preview'),

  // Bring-your-own Azure OpenAI (optional; retained for compatibility).
  AZURE_OPENAI_ENDPOINT: z.string().url().optional().or(z.literal('')),
  AZURE_OPENAI_API_KEY: z.string().optional().or(z.literal('')),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional().or(z.literal('')),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-10-21'),
});

export type Env = z.infer<typeof envSchema>;

/** How the server authenticates to Azure OpenAI. */
export type AzureOpenAIAuth =
  | { kind: 'apiKey'; apiKey: string }
  | { kind: 'entra' };

export interface AzureOpenAIConfig {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  auth: AzureOpenAIAuth;
}

export interface AppConfig {
  port: number;
  host: string;
  corsOrigin: string;
  /**
   * Present when Azure OpenAI endpoint + deployment are provided. Auth is by API
   * key when AZURE_OPENAI_API_KEY is set, otherwise keyless via Entra ID.
   */
  azureOpenAI: AzureOpenAIConfig | null;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = envSchema.parse(source);

  // Prefer explicit Foundry configuration; fall back to Azure OpenAI.
  const isFoundry = !!env.AZURE_FOUNDRY_ENDPOINT && !!env.AZURE_FOUNDRY_MODEL;
  const endpoint = isFoundry ? env.AZURE_FOUNDRY_ENDPOINT : env.AZURE_OPENAI_ENDPOINT;
  const deployment = isFoundry ? env.AZURE_FOUNDRY_MODEL : env.AZURE_OPENAI_DEPLOYMENT;
  const apiKey = isFoundry ? env.AZURE_FOUNDRY_API_KEY : env.AZURE_OPENAI_API_KEY;
  const apiVersion = isFoundry ? env.AZURE_FOUNDRY_API_VERSION : env.AZURE_OPENAI_API_VERSION;
  const hasAi = !!endpoint && !!deployment;

  return {
    port: env.PORT,
    host: env.HOST,
    corsOrigin: env.CORS_ORIGIN,
    azureOpenAI: hasAi
      ? {
          endpoint: endpoint as string,
          deployment: deployment as string,
          apiVersion,
          auth: apiKey
            ? { kind: 'apiKey', apiKey }
            : { kind: 'entra' },
        }
      : null,
  };
}
