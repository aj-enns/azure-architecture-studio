import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AZURE_ICONS_DIR, ICON_OVERRIDES, PATHS } from './config.js';

/** Loose normalization for fuzzy filename/name matching. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\.svg$/, '').replace(/[^a-z0-9]/g, '');
}

interface IconIndex {
  /** slug -> absolute path in the bundled dir. */
  bundled: Map<string, string>;
  /** normalized-name -> slug, from bundled + optional source library. */
  byName: Map<string, { slug: string; sourcePath?: string }>;
}

function slugsIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.svg'))
    .map((f) => f.replace(/\.svg$/i, ''));
}

export function buildIconIndex(): IconIndex {
  const bundled = new Map<string, string>();
  const byName = new Map<string, { slug: string; sourcePath?: string }>();

  for (const slug of slugsIn(PATHS.bundledIcons)) {
    const path = resolve(PATHS.bundledIcons, `${slug}.svg`);
    bundled.set(slug, path);
    byName.set(normalize(slug), { slug });
  }

  if (AZURE_ICONS_DIR && existsSync(AZURE_ICONS_DIR)) {
    for (const slug of slugsIn(AZURE_ICONS_DIR)) {
      const key = normalize(slug);
      if (!byName.has(key)) byName.set(key, { slug, sourcePath: resolve(AZURE_ICONS_DIR, `${slug}.svg`) });
    }
  }
  return { bundled, byName };
}

/**
 * Resolve an icon slug for a service, ensuring the SVG ends up in the bundled
 * dir (copying from the official source library when needed). Returns undefined
 * when no official icon is available — the caller then excludes the candidate.
 */
export function resolveIcon(
  index: IconIndex,
  opts: { resourceType: string; name: string; preferred?: string },
): string | undefined {
  const candidates = [
    opts.preferred,
    ICON_OVERRIDES[opts.resourceType.toLowerCase()],
    opts.name,
    opts.name.replace(/^(azure|microsoft)\s+/i, ''),
    opts.resourceType.split('/')[1],
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    const key = normalize(candidate);
    const hit = index.byName.get(key);
    if (!hit) continue;
    if (index.bundled.has(hit.slug)) return hit.slug;
    if (hit.sourcePath) {
      const dest = resolve(PATHS.bundledIcons, `${hit.slug}.svg`);
      copyFileSync(hit.sourcePath, dest);
      index.bundled.set(hit.slug, dest);
      return hit.slug;
    }
  }
  return undefined;
}
