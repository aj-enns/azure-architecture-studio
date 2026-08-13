import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { aiDiagramJsonSchema, aiDiagramSpecSchema, type AiDiagramSpec } from './spec.js';
import type { AzureOpenAIConfig } from '../config.js';

/** OAuth scope for data-plane access to Azure OpenAI / Cognitive Services. */
const COGNITIVE_SERVICES_SCOPE = 'https://cognitiveservices.azure.com/.default';

/** Raised when Azure OpenAI returns an error or an unparseable response. */
export class AiGenerationError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'AiGenerationError';
  }
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
}

/**
 * Lazily-created Entra ID token provider. DefaultAzureCredential resolves the
 * ambient identity (az login, VS Code, environment vars, or managed identity in
 * Azure); getBearerTokenProvider caches and refreshes the token for us.
 */
let tokenProvider: (() => Promise<string>) | null = null;
function getTokenProvider(): () => Promise<string> {
  if (!tokenProvider) {
    tokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), COGNITIVE_SERVICES_SCOPE);
  }
  return tokenProvider;
}

/** Builds the auth header for the request based on the configured auth mode (ADR-0011). */
async function buildAuthHeaders(config: AzureOpenAIConfig): Promise<Record<string, string>> {
  if (config.auth.kind === 'apiKey') {
    return { 'api-key': config.auth.apiKey };
  }
  try {
    const token = await getTokenProvider()();
    return { Authorization: `Bearer ${token}` };
  } catch (err) {
    throw new AiGenerationError(
      `Failed to acquire a Microsoft Entra ID token. Ensure the host is signed in ` +
        `(az login) or has a managed identity with the "Cognitive Services OpenAI User" ` +
        `role. Details: ${err instanceof Error ? err.message : 'unknown error'}`,
      401,
    );
  }
}

/**
 * Calls Azure OpenAI Chat Completions with structured outputs and returns the
 * parsed JSON. Uses global fetch (Node 22) — no SDK (ADR-0010). Supports
 * API-key and keyless Entra ID auth (ADR-0011). Callers validate the shape.
 */
export async function generateJson(
  config: AzureOpenAIConfig,
  systemPrompt: string,
  userPrompt: string,
  schema: { name: string; jsonSchema: unknown },
  signal?: AbortSignal,
  images?: string[],
): Promise<unknown> {
  const endpoint = config.endpoint.replace(/\/$/, '');
  const isFoundryModelsEndpoint = new URL(endpoint).hostname.endsWith('.services.ai.azure.com');
  const url = isFoundryModelsEndpoint
    ? `${endpoint.endsWith('/models') ? endpoint : `${endpoint}/models`}/chat/completions?api-version=${config.apiVersion}`
    : `${endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;

  const authHeaders = await buildAuthHeaders(config);
  const requestController = new AbortController();
  const timeout = setTimeout(() => requestController.abort(), 120_000);
  const requestSignal = signal
    ? AbortSignal.any([signal, requestController.signal])
    : requestController.signal;

  // Vision path: user content becomes an array of text + image parts (ADR-0010).
  const userContent =
    images && images.length > 0
      ? [
          { type: 'text', text: userPrompt },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ]
      : userPrompt;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        ...(isFoundryModelsEndpoint ? { model: config.deployment } : {}),
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: schema.name,
            strict: true,
            schema: schema.jsonSchema,
          },
        },
      }),
      signal: requestSignal,
    });
  } catch (err) {
    if (requestController.signal.aborted && !signal?.aborted) {
      throw new AiGenerationError('The AI request timed out after 120 seconds.', 504);
    }
    throw new AiGenerationError(
      `Failed to reach Azure OpenAI: ${err instanceof Error ? err.message : 'network error'}`,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      const authHint =
        config.auth.kind === 'entra'
          ? 'Verify the Entra identity is signed in and has the "Cognitive Services OpenAI User" role on the resource.'
          : 'Verify the Azure OpenAI API key is valid and has not expired.';
      throw new AiGenerationError(
        `Azure OpenAI authorization failed (${response.status}). ${authHint}`,
        response.status,
      );
    }
    throw new AiGenerationError(
      `Azure OpenAI returned ${response.status}: ${detail.slice(0, 500)}`,
      response.status === 429 ? 429 : 502,
    );
  }

  const body = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
  const message = body?.choices?.[0]?.message;
  if (message?.refusal) {
    throw new AiGenerationError(`Model refused the request: ${message.refusal}`, 422);
  }
  const content = message?.content;
  if (!content) {
    throw new AiGenerationError('Azure OpenAI returned an empty response.', 502);
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new AiGenerationError('Azure OpenAI returned invalid JSON.', 502);
  }
  return json;
}

/** Prompt-to-diagram generation: structured output validated against the AI spec. */
export async function generateSpec(
  config: AzureOpenAIConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<AiDiagramSpec> {
  const json = await generateJson(
    config,
    systemPrompt,
    userPrompt,
    { name: 'azure_architecture_diagram', jsonSchema: aiDiagramJsonSchema },
    signal,
  );

  const parsed = aiDiagramSpecSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiGenerationError(
      `Model output did not match the expected schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      502,
    );
  }
  return parsed.data;
}

/** Image-to-diagram: transcribes an architecture diagram image into the AI spec. */
export async function generateSpecFromImage(
  config: AzureOpenAIConfig,
  systemPrompt: string,
  userPrompt: string,
  images: string[],
  signal?: AbortSignal,
): Promise<AiDiagramSpec> {
  const json = await generateJson(
    config,
    systemPrompt,
    userPrompt,
    { name: 'azure_architecture_diagram', jsonSchema: aiDiagramJsonSchema },
    signal,
    images,
  );

  const parsed = aiDiagramSpecSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiGenerationError(
      `Model output did not match the expected schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      502,
    );
  }
  return parsed.data;
}
