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
import type { ServiceCategory } from '@aar/shared';

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

export { KeyRound }; // re-export for convenience where a generic key icon is handy
