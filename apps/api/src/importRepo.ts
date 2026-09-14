import { scanRepoFiles, type Diagram, type RepoFile } from '@aar/shared';

/**
 * Fetches Bicep/Terraform/ARM files from a public GitHub repository and maps them
 * to a diagram deterministically. Restricted to github.com (SSRF-safe); an
 * optional GITHUB_TOKEN raises rate limits. Files can also be posted directly by
 * the browser, in which case this module is not involved.
 */

const MAX_FILES = 200;
const MAX_FILE_BYTES = 1_000_000;

export class RepoImportError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'RepoImportError';
  }
}

export interface ImportRepoDependencies {
  fetch?: typeof fetch;
  token?: string;
}

interface GitHubTreeEntry {
  path?: unknown;
  type?: unknown;
  size?: unknown;
}

const NAME_RE = /^[A-Za-z0-9._-]+$/;

/** Only fetch .json that plausibly holds an ARM template (avoids package.json spam). */
function looksLikeArmJson(path: string): boolean {
  return (
    /(azuredeploy|deploy\.json$|template\.json$|\.arm\.json$)/i.test(path) ||
    /(^|\/)(arm|templates?)\//i.test(path)
  );
}

function isCandidatePath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith('.bicep') || lower.endsWith('.tf')) return true;
  if (lower.endsWith('.json')) return looksLikeArmJson(lower);
  return false;
}

interface ParsedRepo {
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
}

export function parseGitHubUrl(raw: string): ParsedRepo {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RepoImportError('Enter a valid GitHub repository URL.', 400);
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw new RepoImportError('Only github.com repositories are supported.', 400);
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const repoRaw = parts[1];
  if (!owner || !repoRaw || !NAME_RE.test(owner)) {
    throw new RepoImportError('Could not parse owner/repo from the URL.', 400);
  }
  const repo = repoRaw.replace(/\.git$/, '');
  if (!NAME_RE.test(repo)) {
    throw new RepoImportError('Could not parse owner/repo from the URL.', 400);
  }
  // .../tree/<ref>/<subpath...>
  if (parts[2] === 'tree' && parts[3]) {
    return { owner, repo, ref: parts[3], subpath: parts.slice(4).join('/') || undefined };
  }
  return { owner, repo };
}

export async function importFromGitHub(
  url: string,
  deps: ImportRepoDependencies = {},
): Promise<Diagram> {
  const fetchImpl = deps.fetch ?? fetch;
  const token = deps.token ?? process.env.GITHUB_TOKEN;
  const apiHeaders: Record<string, string> = {
    'User-Agent': 'azure-architecture-review',
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const { owner, repo, ref: refInput, subpath } = parseGitHubUrl(url);

  let ref = refInput;
  if (!ref) {
    const repoRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: apiHeaders,
    });
    if (!repoRes.ok) {
      throw new RepoImportError(
        `GitHub returned ${repoRes.status} for the repository.`,
        repoRes.status === 404 ? 404 : 502,
      );
    }
    ref = ((await repoRes.json()) as { default_branch?: string }).default_branch ?? 'main';
  }

  const treeRes = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers: apiHeaders },
  );
  if (!treeRes.ok) {
    throw new RepoImportError(
      `GitHub returned ${treeRes.status} listing the repository tree.`,
      treeRes.status === 404 ? 404 : 502,
    );
  }

  const tree = (await treeRes.json()) as { tree?: unknown };
  const entries = Array.isArray(tree.tree) ? (tree.tree as GitHubTreeEntry[]) : [];
  const selected = entries
    .filter(
      (entry): entry is GitHubTreeEntry & { path: string } =>
        entry.type === 'blob' && typeof entry.path === 'string',
    )
    .filter((entry) => !subpath || entry.path === subpath || entry.path.startsWith(`${subpath}/`))
    .filter((entry) => isCandidatePath(entry.path))
    .filter((entry) => typeof entry.size !== 'number' || entry.size <= MAX_FILE_BYTES)
    .slice(0, MAX_FILES);

  const rawHeaders: Record<string, string> = {
    'User-Agent': 'azure-architecture-review',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const files: RepoFile[] = [];
  for (const entry of selected) {
    const rawRes = await fetchImpl(
      `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
      { headers: rawHeaders },
    );
    if (!rawRes.ok) continue;
    files.push({ path: entry.path, content: await rawRes.text() });
  }

  if (files.length === 0) {
    throw new RepoImportError(
      'No Bicep, Terraform, or ARM files were found in that repository.',
      404,
    );
  }

  return scanRepoFiles(files, `${owner}/${repo}`);
}
