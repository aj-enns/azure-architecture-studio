import {
  safeParseDiagram,
  type Diagram,
  type IacBundle,
  type IacTarget,
  type ResiliencyReport,
  type SlaProfile,
} from '@aar/shared';

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
  options?: { mode?: DesignMode; model?: string; signal?: AbortSignal },
): Promise<Diagram> {
  const { mode, model, signal } = options ?? {};
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
      body: JSON.stringify({
        prompt,
        ...(current ? { current } : {}),
        ...(mode ? { mode } : {}),
        ...(model ? { model } : {}),
      }),
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

/**
 * Imports a compiled ARM/Bicep template (JSON) into a diagram deterministically
 * (no model). Throws with a human-readable message on failure.
 */
export async function importArmTemplate(template: unknown, name?: string): Promise<Diagram> {
  const res = await fetch('/api/import/arm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template, ...(name ? { name } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Template import failed (${res.status})`);
  }
  const body = (await res.json()) as { diagram?: unknown };
  const parsed = safeParseDiagram(body.diagram);
  if (!parsed.success) {
    throw new Error('The API returned an invalid diagram.');
  }
  return parsed.data;
}

/**
 * Imports the resources of an Azure resource group into a diagram via the API's
 * Azure Resource Graph query. Requires the API host to be authenticated to Azure.
 */
export async function importFromAzure(
  subscriptionId: string,
  resourceGroup: string,
): Promise<Diagram> {
  const res = await fetch('/api/import/azure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscriptionId, resourceGroup }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Azure import failed (${res.status})`);
  }
  const body = (await res.json()) as { diagram?: unknown };
  const parsed = safeParseDiagram(body.diagram);
  if (!parsed.success) {
    throw new Error('The API returned an invalid diagram.');
  }
  return parsed.data;
}

/** Imports a repository's IaC files (Bicep/Terraform/ARM) into a diagram. */
export async function importRepoFiles(
  files: { path: string; content: string }[],
  name?: string,
): Promise<Diagram> {
  const res = await fetch('/api/import/repo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, ...(name ? { name } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Repository import failed (${res.status})`);
  }
  const body = (await res.json()) as { diagram?: unknown };
  const parsed = safeParseDiagram(body.diagram);
  if (!parsed.success) {
    throw new Error('The API returned an invalid diagram.');
  }
  return parsed.data;
}

/** Imports a public GitHub repository's IaC into a diagram (server fetches it). */
export async function importRepoFromGitHub(githubUrl: string): Promise<Diagram> {
  const res = await fetch('/api/import/repo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ githubUrl }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `GitHub import failed (${res.status})`);
  }
  const body = (await res.json()) as { diagram?: unknown };
  const parsed = safeParseDiagram(body.diagram);
  if (!parsed.success) {
    throw new Error('The API returned an invalid diagram.');
  }
  return parsed.data;
}

/**
 * Transcribes an uploaded diagram image (PNG/JPEG data URL) into a diagram via
 * the API. Throws with a human-readable message on failure.
 */
export async function generateDiagramFromImage(
  image: string,
  prompt?: string,
  options?: { mode?: DesignMode; model?: string; signal?: AbortSignal },
): Promise<Diagram> {
  const { mode, model, signal } = options ?? {};
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 150_000);
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  let res: Response;
  try {
    res = await fetch('/api/generate/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image,
        ...(prompt ? { prompt } : {}),
        ...(mode ? { mode } : {}),
        ...(model ? { model } : {}),
      }),
      signal: requestSignal,
    });
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error('Image import timed out. Check the API logs and try again.');
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Image import was cancelled.');
    }
    throw new Error(error instanceof Error ? error.message : 'Could not reach the API.');
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Image import failed (${res.status})`);
  }

  const body = (await res.json()) as { diagram?: unknown };
  const parsed = safeParseDiagram(body.diagram);
  if (!parsed.success) {
    throw new Error('The API returned an invalid diagram.');
  }
  return parsed.data;
}

export interface ResiliencyResult {
  report: ResiliencyReport;
  /** Present only when a grounded refresh succeeded. */
  profiles?: SlaProfile[];
  citations?: { title: string; url: string; excerpt: string }[];
  /** Set when a grounded refresh was requested but could not complete. */
  groundingError?: string;
}

/**
 * Analyses composite SLA / RTO / RPO for a diagram. The API always returns the
 * deterministic baseline report; `grounded` additionally refreshes the figures
 * from Microsoft Learn and reports why if that fails.
 */
export async function analyzeDiagramResiliency(
  diagram: Diagram,
  options?: { grounded?: boolean; signal?: AbortSignal },
): Promise<ResiliencyResult> {
  const res = await fetch('/api/resiliency', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diagram, grounded: options?.grounded ?? false }),
    signal: options?.signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Resiliency analysis failed (${res.status})`);
  }
  const body = (await res.json()) as Partial<ResiliencyResult>;
  if (!body.report) throw new Error('The API returned an invalid resiliency report.');
  return body as ResiliencyResult;
}

export interface ArchitectureReviewResult {
  markdown: string;
  citations?: { title: string; url: string; excerpt: string }[];
  /** Set when grounding was requested but could not complete. */
  groundingError?: string;
}

export interface AdvisorMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ArchitectureAdviceResult {
  markdown: string;
  diagramPrompt: string | null;
  citations: { title: string; url: string; excerpt: string }[];
  /** Set when Microsoft Learn grounding was unavailable. */
  groundingError?: string;
}

/** Ask a non-mutating architecture question about the latest diagram. */
export async function askArchitecture(
  message: string,
  diagram: Diagram,
  history: AdvisorMessage[],
  options?: { model?: string; signal?: AbortSignal },
): Promise<ArchitectureAdviceResult> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 150_000);
  const requestSignal = options?.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;

  let res: Response;
  try {
    res = await fetch('/api/advise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        diagram,
        history: history.slice(-10),
        ...(options?.model ? { model: options.model } : {}),
      }),
      signal: requestSignal,
    });
  } catch (error) {
    if (timeoutController.signal.aborted && !options?.signal?.aborted) {
      throw new Error('Architecture advice timed out. Check the API logs and try again.');
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Architecture advice was cancelled.');
    }
    throw new Error(error instanceof Error ? error.message : 'Could not reach the API.');
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Architecture advice failed (${res.status})`);
  }

  const body = (await res.json()) as Partial<ArchitectureAdviceResult>;
  if (
    typeof body.markdown !== 'string' ||
    (body.diagramPrompt !== null && typeof body.diagramPrompt !== 'string') ||
    !Array.isArray(body.citations)
  ) {
    throw new Error('The API returned an invalid architecture answer.');
  }
  return body as ArchitectureAdviceResult;
}

export interface ReviewModel {
  deploymentName: string;
  modelName?: string;
  modelVersion?: string;
  isDefault: boolean;
}

export interface ReviewModelList {
  models: ReviewModel[];
  defaultDeployment: string;
  warning?: string;
}

/** Returns the review-compatible deployments configured on the Foundry resource. */
export async function fetchReviewModels(signal?: AbortSignal): Promise<ReviewModelList> {
  const res = await fetch('/api/review/models', { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Could not load review models (${res.status})`);
  }
  const body = (await res.json()) as Partial<ReviewModelList>;
  if (!Array.isArray(body.models) || typeof body.defaultDeployment !== 'string') {
    throw new Error('The API returned an invalid review model list.');
  }
  return body as ReviewModelList;
}

/**
 * Requests an AI architecture review (the waf-architecture-review methodology).
 * Throws with a human-readable message on failure (including 503 when AI is
 * unconfigured).
 */
export async function reviewDiagram(
  diagram: Diagram,
  options?: { grounded?: boolean; model?: string; signal?: AbortSignal },
): Promise<ArchitectureReviewResult> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), 150_000);
  const requestSignal = options?.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;

  let res: Response;
  try {
    res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        diagram,
        grounded: options?.grounded ?? false,
        ...(options?.model ? { model: options.model } : {}),
      }),
      signal: requestSignal,
    });
  } catch (error) {
    if (timeoutController.signal.aborted && !options?.signal?.aborted) {
      throw new Error('The review timed out. Check the API logs and try again.');
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The review was cancelled.');
    }
    throw new Error(error instanceof Error ? error.message : 'Could not reach the API.');
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `Review failed (${res.status})`);
  }
  const body = (await res.json()) as Partial<ArchitectureReviewResult>;
  if (!body.markdown) throw new Error('The API returned an empty review.');
  return body as ArchitectureReviewResult;
}

/** Generate a deterministic IaC bundle for the current diagram. */
export async function generateIac(diagram: Diagram, target: IacTarget): Promise<IacBundle> {
  const res = await fetch('/api/iac', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diagram, target }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.message ?? `IaC generation failed (${res.status})`);
  }
  const body = (await res.json()) as { bundle?: IacBundle };
  if (!body.bundle || body.bundle.target !== target || !Array.isArray(body.bundle.files)) {
    throw new Error('The API returned an invalid IaC bundle.');
  }
  return body.bundle;
}
