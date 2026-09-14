import type { ReferenceArchitecture } from './knowledge.js';

/** A single grounding snippet retrieved from Microsoft Learn. */
export interface LearnDoc {
  title: string;
  url: string;
  excerpt: string;
}

const MCP_PROTOCOL_VERSION = '2025-06-18';
const SEARCH_TOOL = 'microsoft_docs_search';
const REQUEST_TIMEOUT_MS = 8_000;
const PER_QUERY_TIMEOUT_MS = 2_000;
const MAX_BATCH_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 60 * 1000;
const MAX_DOCS = 5;
const MAX_EXCERPT = 400;

const cache = new Map<string, { at: number; docs: LearnDoc[] }>();

interface JsonRpcResponse {
  id?: number | string;
  result?: { content?: { type?: string; text?: string }[]; structuredContent?: unknown };
  error?: { message?: string };
}

/**
 * Extracts JSON-RPC payloads from an MCP HTTP response body, which may be either
 * plain JSON or an SSE (`text/event-stream`) frame with `data:` lines.
 */
function parseJsonRpcBodies(contentType: string, body: string): JsonRpcResponse[] {
  if (contentType.includes('text/event-stream')) {
    const out: JsonRpcResponse[] = [];
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!trimmed || trimmed === '[DONE]') continue;
      try {
        out.push(JSON.parse(trimmed) as JsonRpcResponse);
      } catch {
        /* ignore non-JSON keep-alive frames */
      }
    }
    return out;
  }
  try {
    return [JSON.parse(body) as JsonRpcResponse];
  } catch {
    return [];
  }
}

/**
 * Normalizes the free-form text pieces returned by microsoft_docs_search into
 * structured LearnDocs. The tool may return a JSON array of chunks or markdown;
 * this handles both shapes defensively. Exported for unit testing.
 */
export function parseLearnSearchContent(texts: string[]): LearnDoc[] {
  const docs: LearnDoc[] = [];
  for (const text of texts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      docs.push({ title: 'Microsoft Learn', url: '', excerpt: text });
      continue;
    }
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { results?: unknown }).results)
        ? (parsed as { results: unknown[] }).results
        : [parsed];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const title = String(rec.title ?? rec.name ?? 'Microsoft Learn');
      const url = String(rec.contentUrl ?? rec.url ?? rec.source ?? '');
      const excerpt = String(rec.content ?? rec.excerpt ?? rec.text ?? '');
      if (excerpt) docs.push({ title, url, excerpt });
    }
  }
  return dedupeDocs(docs);
}

function dedupeDocs(docs: LearnDoc[]): LearnDoc[] {
  const seen = new Set<string>();
  const out: LearnDoc[] = [];
  for (const d of docs) {
    const key = d.url || d.title + d.excerpt.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...d, excerpt: d.excerpt.slice(0, MAX_EXCERPT) });
  }
  return out;
}

async function mcpCall(
  endpoint: string,
  method: string,
  params: unknown,
  id: number | null,
  sessionId: string | undefined,
  signal: AbortSignal,
): Promise<{ bodies: JsonRpcResponse[]; sessionId?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      id === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params },
    ),
    signal,
  });
  const newSession = res.headers.get('mcp-session-id') ?? sessionId;
  // Notifications return 202 with no body.
  if (res.status === 202) return { bodies: [], sessionId: newSession };
  const body = await res.text();
  return {
    bodies: parseJsonRpcBodies(res.headers.get('content-type') ?? '', body),
    sessionId: newSession,
  };
}

/** Performs the MCP handshake and returns the session id to reuse for tool calls. */
async function openSession(endpoint: string, signal: AbortSignal): Promise<string | undefined> {
  const init = await mcpCall(
    endpoint,
    'initialize',
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'azure-architecture-review', version: '0.1.0' },
    },
    1,
    undefined,
    signal,
  );
  const sessionId = init.sessionId;
  await mcpCall(endpoint, 'notifications/initialized', {}, null, sessionId, signal);
  return sessionId;
}

async function callSearchTool(
  endpoint: string,
  sessionId: string | undefined,
  query: string,
  id: number,
  signal: AbortSignal,
): Promise<LearnDoc[]> {
  const call = await mcpCall(
    endpoint,
    'tools/call',
    { name: SEARCH_TOOL, arguments: { query } },
    id,
    sessionId,
    signal,
  );
  const result = call.bodies.find((b) => b.result)?.result;
  const texts = (result?.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string);
  return parseLearnSearchContent(texts).slice(0, MAX_DOCS);
}

/**
 * Runs several documentation searches over a single MCP session, so the
 * initialize/initialized handshake is paid once rather than per query. Results
 * are positional. Best-effort: a failed query yields an empty array.
 */
export async function searchLearnDocsBatch(
  queries: string[],
  endpoint: string,
): Promise<LearnDoc[][]> {
  if (queries.length === 0) return [];
  const budget = Math.min(
    REQUEST_TIMEOUT_MS + queries.length * PER_QUERY_TIMEOUT_MS,
    MAX_BATCH_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const sessionId = await openSession(endpoint, controller.signal);
    return await Promise.all(
      queries.map((query, i) =>
        callSearchTool(endpoint, sessionId, query, i + 2, controller.signal).catch(() => []),
      ),
    );
  } catch {
    return queries.map(() => []);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Queries the Microsoft Learn MCP server for documentation relevant to a search
 * string. Best-effort: any failure resolves to an empty array so generation
 * never blocks.
 */
export async function searchLearnDocs(query: string, endpoint: string): Promise<LearnDoc[]> {
  const [docs] = await searchLearnDocsBatch([query], endpoint);
  return docs ?? [];
}

function readCache(key: string): LearnDoc[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  // A transient outage shouldn't be remembered as "no docs" for the full TTL.
  const ttl = hit.docs.length === 0 ? EMPTY_CACHE_TTL_MS : CACHE_TTL_MS;
  if (Date.now() - hit.at >= ttl) {
    cache.delete(key);
    return null;
  }
  return hit.docs;
}

/** Batch search with the shared 30-minute result cache applied per query. */
export async function searchLearnDocsCached(
  queries: string[],
  endpoint: string,
): Promise<LearnDoc[][]> {
  const keys = queries.map((q) => q.toLowerCase());
  const results: (LearnDoc[] | null)[] = keys.map(readCache);
  const missIndexes = results.flatMap((r, i) => (r === null ? [i] : []));
  if (missIndexes.length > 0) {
    const fetched = await searchLearnDocsBatch(
      missIndexes.map((i) => queries[i] as string),
      endpoint,
    );
    missIndexes.forEach((target, n) => {
      const docs = fetched[n] ?? [];
      cache.set(keys[target] as string, { at: Date.now(), docs });
      results[target] = docs;
    });
  }
  return results.map((r) => r ?? []);
}

/** Renders retrieved Learn docs as grounding text for the system prompt. */
export function formatLearnGrounding(docs: LearnDoc[]): string {
  if (docs.length === 0) return '';
  const items = docs
    .map((d) => `- ${d.title}${d.url ? ` (${d.url})` : ''}: ${d.excerpt}`)
    .join('\n');
  return `Current Microsoft Learn documentation relevant to this request:\n${items}`;
}

/**
 * Retrieves Learn grounding for a prompt. A single search keeps latency low; the
 * top retrieved reference architecture's name augments the query for precision.
 * Returns null when disabled or when nothing is found (soft-fail).
 */
export async function getLearnGrounding(
  config: { enabled: boolean; endpoint: string },
  prompt: string,
  architectures: ReferenceArchitecture[],
): Promise<{ text: string; citations: LearnDoc[] } | null> {
  if (!config.enabled) return null;

  const query = architectures[0] ? `${prompt} (${architectures[0].name})` : prompt;
  const [docs = []] = await searchLearnDocsCached([query], config.endpoint);

  if (docs.length === 0) return null;
  return { text: formatLearnGrounding(docs), citations: docs };
}
