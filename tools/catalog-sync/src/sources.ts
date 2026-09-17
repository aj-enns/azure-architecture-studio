import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PATHS } from './config.js';

const GH = process.env.GITHUB_TOKEN;
const ghHeaders: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'aas-catalog-sync',
  ...(GH ? { Authorization: `Bearer ${GH}` } : {}),
};

export interface RawModule {
  group: string;
  name: string;
  avmModule: string;
  resourceType?: string;
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** List published AVM resource modules from the bicep-registry-modules tree. */
export async function fetchAvmModules(): Promise<RawModule[]> {
  try {
    const tree = (await getJson(
      'https://api.github.com/repos/Azure/bicep-registry-modules/git/trees/main?recursive=1',
      ghHeaders,
    )) as { tree?: { path?: string }[] };
    const modules: RawModule[] = [];
    for (const entry of tree.tree ?? []) {
      const m = entry.path?.match(/^avm\/res\/([^/]+)\/([^/]+)\/main\.json$/);
      const group = m?.[1];
      const name = m?.[2];
      if (!group || !name) continue;
      modules.push({ group, name, avmModule: `br/public:avm/res/${group}/${name}` });
    }
    return modules;
  } catch (err) {
    console.warn(`  ! AVM module list unavailable (${(err as Error).message}) — using pins only.`);
    return [];
  }
}

/** Helper resources that appear in nearly every compiled AVM module. */
const HELPER_TYPES = new Set([
  'microsoft.resources/deployments',
  'microsoft.authorization/roleassignments',
  'microsoft.authorization/locks',
  'microsoft.insights/diagnosticsettings',
]);

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Best-effort ARM resource type for a module, read from its compiled main.json. */
export async function resolveResourceType(mod: RawModule): Promise<string | undefined> {
  try {
    const raw = (await getJson(
      `https://raw.githubusercontent.com/Azure/bicep-registry-modules/main/avm/res/${mod.group}/${mod.name}/main.json`,
    )) as { resources?: Record<string, { type?: string }> | { type?: string }[] };
    const list = Array.isArray(raw.resources) ? raw.resources : Object.values(raw.resources ?? {});
    const types = [
      ...new Set(
        list
          .map((r) => r.type)
          .filter((t): t is string => typeof t === 'string' && /^Microsoft\.[^/]+\/[^/]+$/.test(t))
          .filter((t) => !HELPER_TYPES.has(t.toLowerCase())),
      ),
    ];
    if (types.length === 0) return undefined;
    // Pick the type whose last segment best matches the module name.
    const wanted = mod.name.replace(/-/g, '');
    const best = types
      .map((t) => ({ t, score: commonPrefix((t.split('/')[1] ?? '').toLowerCase(), wanted) }))
      .sort((a, b) => b.score - a.score)[0];
    return best?.t;
  } catch {
    return undefined;
  }
}

/** GitHub code-search hit count for a resource type, cached across runs. */
export async function fetchPopularity(resourceTypes: string[]): Promise<Map<string, number>> {
  const cache: Record<string, number> = existsSync(PATHS.popularityCache)
    ? JSON.parse(readFileSync(PATHS.popularityCache, 'utf8'))
    : {};
  const scores = new Map<string, number>(Object.entries(cache));
  if (!GH) {
    console.warn('  ! No GITHUB_TOKEN — skipping popularity ranking (using cached scores if any).');
    return scores;
  }
  for (const type of resourceTypes) {
    if (scores.has(type)) continue;
    try {
      const url = `https://api.github.com/search/code?q=${encodeURIComponent(`"${type}"`)}&per_page=1`;
      const body = (await getJson(url, ghHeaders)) as { total_count?: number };
      scores.set(type, body.total_count ?? 0);
      cache[type] = body.total_count ?? 0;
      await new Promise((r) => setTimeout(r, 6500)); // code-search allows ~10 req/min
    } catch (err) {
      console.warn(`  ! popularity for ${type} failed (${(err as Error).message})`);
    }
  }
  writeFileSync(PATHS.popularityCache, `${JSON.stringify(cache, null, 2)}\n`);
  return scores;
}
