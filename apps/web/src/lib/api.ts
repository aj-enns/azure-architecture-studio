import { safeParseDiagram, type Diagram } from '@aar/shared';

export interface HealthStatus {
  status: string;
  aiConfigured: boolean;
}

/** Returns API health, including whether AI generation is configured. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthStatus> {
  const res = await fetch('/healthz', { signal });
  if (!res.ok) throw new Error(`Health check failed (${res.status})`);
  return (await res.json()) as HealthStatus;
}

interface ApiError {
  error?: string;
  message?: string;
}

export type DesignMode = 'faithful' | 'bestPractice';

/**
 * Requests an AI-generated diagram from the API. Throws with a human-readable
 * message on failure (including 503 when AI is unconfigured).
 */
export async function generateDiagram(
  prompt: string,
  current?: Diagram,
  options?: { mode?: DesignMode; signal?: AbortSignal },
): Promise<Diagram> {
  const { mode, signal } = options ?? {};
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 150_000);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  let res: Response;
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...(current ? { current } : {}), ...(mode ? { mode } : {}) }),
      signal: requestSignal,
    });
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error('AI generation timed out. Check the API logs and try again.');
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('AI generation was cancelled.');
    }
    throw new Error(error instanceof Error ? error.message : 'Could not reach the API.');
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Generation failed (${res.status})`);
  }

  const body = (await res.json()) as { diagram?: unknown };
  const parsed = safeParseDiagram(body.diagram);
  if (!parsed.success) {
    throw new Error('The API returned an invalid diagram.');
  }
  return parsed.data;
}
