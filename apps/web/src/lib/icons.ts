import {
  Boxes,
  BrainCircuit,
  Cloud,
  Container,
  Cpu,
  Database,
  Fingerprint,
  Gauge,
  Globe,
  HardDrive,
  KeyRound,
  Network,
  Server,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { ServiceCategory } from '@aas/shared';

/**
 * Fallback icon per catalog category, used until the official Microsoft Azure
 * SVG icons are bundled into src/assets/azure-icons/. Once present, a service's
 * `icon` slug should be preferred over this category fallback.
 */
const categoryIcon: Record<ServiceCategory, LucideIcon> = {
  compute: Cpu,
  containers: Container,
  web: Globe,
  databases: Database,
  storage: HardDrive,
  networking: Network,
  ai: BrainCircuit,
  analytics: Gauge,
  integration: Workflow,
  security: ShieldCheck,
  identity: Fingerprint,
  devops: Boxes,
  management: Server,
};

export function iconForCategory(category: ServiceCategory): LucideIcon {
  return categoryIcon[category] ?? Cloud;
}

/**
 * Official Microsoft Azure Architecture Icons, resolved at build time from any
 * SVGs dropped into src/assets/azure-icons/. The map is keyed by filename slug
 * (e.g. "app-service") which matches a service's `icon` field in the catalog.
 * When the folder is empty (icons not yet added) this is simply empty and
 * callers fall back to the Lucide category glyph.
 */
const azureIconUrls = import.meta.glob<string>('../assets/azure-icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

const iconUrlBySlug: Record<string, string> = {};
for (const [path, url] of Object.entries(azureIconUrls)) {
  const slug = path
    .split('/')
    .pop()
    ?.replace(/\.svg$/, '');
  if (slug) iconUrlBySlug[slug] = url;
}

/** URL of the official Azure SVG for a slug, or undefined if not bundled. */
export function azureIconUrl(slug: string | undefined): string | undefined {
  return slug ? iconUrlBySlug[slug] : undefined;
}

/** Accent color per category (Tailwind classes) for palette + node chrome. */
export const categoryColor: Record<ServiceCategory, string> = {
  compute: 'text-sky-500',
  containers: 'text-blue-500',
  web: 'text-indigo-500',
  databases: 'text-emerald-500',
  storage: 'text-amber-500',
  networking: 'text-cyan-500',
  ai: 'text-fuchsia-500',
  analytics: 'text-violet-500',
  integration: 'text-teal-500',
  security: 'text-rose-500',
  identity: 'text-orange-500',
  devops: 'text-slate-500',
  management: 'text-lime-600',
};

/** Left-border accent per category, used to color-code nodes on the canvas. */
export const categoryBorderColor: Record<ServiceCategory, string> = {
  compute: '!border-l-sky-500',
  containers: '!border-l-blue-500',
  web: '!border-l-indigo-500',
  databases: '!border-l-emerald-500',
  storage: '!border-l-amber-500',
  networking: '!border-l-cyan-500',
  ai: '!border-l-fuchsia-500',
  analytics: '!border-l-violet-500',
  integration: '!border-l-teal-500',
  security: '!border-l-rose-500',
  identity: '!border-l-orange-500',
  devops: '!border-l-slate-500',
  management: '!border-l-lime-600',
};

/** Raw hex per category (Tailwind 500/600) for SVG strokes like edge connectors. */
export const categoryHex: Record<ServiceCategory, string> = {
  compute: '#0ea5e9',
  containers: '#3b82f6',
  web: '#6366f1',
  databases: '#10b981',
  storage: '#f59e0b',
  networking: '#06b6d4',
  ai: '#d946ef',
  analytics: '#8b5cf6',
  integration: '#14b8a6',
  security: '#f43f5e',
  identity: '#f97316',
  devops: '#64748b',
  management: '#65a30d',
};

export { KeyRound }; // re-export for convenience where a generic key icon is handy
