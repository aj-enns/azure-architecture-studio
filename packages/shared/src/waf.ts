import { getServiceDefinition, type ServiceCategory } from './catalog.js';
import type { Diagram } from './schema.js';

/** The five Well-Architected Framework pillars. */
export type WafPillar = 'security' | 'reliability' | 'performance' | 'cost' | 'operational';

export type WafSeverity = 'high' | 'medium' | 'low';

export interface WafFinding {
  id: string;
  pillar: WafPillar;
  severity: WafSeverity;
  title: string;
  message: string;
  /** How to resolve it — usually a service to add. */
  fix: string;
  /** Catalog service ids the finding relates to, when applicable. */
  serviceIds?: string[];
}

export interface WafReport {
  findings: WafFinding[];
  scoreByPillar: Record<WafPillar, number>;
  overallScore: number;
}

export const WAF_PILLARS: WafPillar[] = [
  'security',
  'reliability',
  'performance',
  'cost',
  'operational',
];

const SEVERITY_PENALTY: Record<WafSeverity, number> = { high: 30, medium: 15, low: 7 };

// Service groupings the rules reason about.
const DATA_SERVICES = ['sql-database', 'cosmos-db', 'postgresql', 'redis', 'storage-account'];
const PUBLIC_ENTRY = [
  'app-service',
  'functions',
  'static-web-app',
  'api-management',
  'aks',
  'container-apps',
];
const WAF_FRONTS = ['application-gateway', 'front-door'];
const IDENTITY_CAPABLE = ['app-service', 'functions', 'aks', 'container-apps', 'api-management'];

/**
 * Deterministically evaluate a diagram against Well-Architected Framework
 * best practices. Pure and rule-based (no model) so results are stable and
 * testable. Only fires rules relevant to the services actually present.
 */
export function validateArchitecture(diagram: Diagram): WafReport {
  const ids = new Set(diagram.nodes.map((n) => n.serviceId));
  const categories = new Set<ServiceCategory>();
  for (const n of diagram.nodes) {
    const cat = getServiceDefinition(n.serviceId)?.category;
    if (cat) categories.add(cat);
  }
  const has = (id: string) => ids.has(id);
  const hasAny = (list: string[]) => list.some((id) => ids.has(id));
  const present = (list: string[]) => list.filter((id) => ids.has(id));

  const findings: WafFinding[] = [];
  const add = (f: WafFinding) => findings.push(f);

  // ---- Security ----------------------------------------------------------
  if (hasAny(DATA_SERVICES) && !has('key-vault')) {
    add({
      id: 'sec-key-vault',
      pillar: 'security',
      severity: 'medium',
      title: 'No Key Vault for secrets',
      message:
        'Data services are present but there is no Key Vault to hold connection strings, keys, or certificates.',
      fix: 'Add Key Vault and reference secrets from it.',
      serviceIds: present(DATA_SERVICES),
    });
  }
  if (hasAny(IDENTITY_CAPABLE) && !has('managed-identity') && !has('entra-id')) {
    add({
      id: 'sec-managed-identity',
      pillar: 'security',
      severity: 'medium',
      title: 'No managed identity',
      message:
        'Compute services should authenticate to Azure resources with a managed identity rather than keys or secrets.',
      fix: 'Add Managed Identity and grant it least-privilege roles.',
      serviceIds: present(IDENTITY_CAPABLE),
    });
  }
  if (hasAny(PUBLIC_ENTRY) && !hasAny(WAF_FRONTS)) {
    add({
      id: 'sec-waf',
      pillar: 'security',
      severity: 'medium',
      title: 'No web application firewall',
      message: 'Internet-facing workloads are not protected by a WAF.',
      fix: 'Front public entry points with Application Gateway (WAF) or Azure Front Door.',
      serviceIds: present(PUBLIC_ENTRY),
    });
  }
  if (hasAny(DATA_SERVICES) && !has('private-endpoint')) {
    add({
      id: 'sec-private-endpoint',
      pillar: 'security',
      severity: 'low',
      title: 'Public data-plane access',
      message: 'Data services are reachable over public networking.',
      fix: 'Use Private Endpoints to keep data traffic on the virtual network.',
      serviceIds: present(DATA_SERVICES),
    });
  }

  // ---- Reliability -------------------------------------------------------
  if (has('vm') && !has('vmss')) {
    add({
      id: 'rel-vmss',
      pillar: 'reliability',
      severity: 'low',
      title: 'Single virtual machine',
      message: 'A standalone VM is a single point of failure.',
      fix: 'Use a VM Scale Set (or multiple zones) for redundancy.',
      serviceIds: ['vm'],
    });
  }
  if (hasAny(PUBLIC_ENTRY) && !hasAny([...WAF_FRONTS, 'load-balancer'])) {
    add({
      id: 'rel-lb',
      pillar: 'reliability',
      severity: 'low',
      title: 'No load balancing',
      message: 'There is no load balancer or gateway distributing traffic for high availability.',
      fix: 'Add a Load Balancer, Application Gateway, or Front Door.',
    });
  }

  // ---- Performance -------------------------------------------------------
  if (
    hasAny(['sql-database', 'postgresql', 'cosmos-db']) &&
    !has('redis') &&
    categories.has('web')
  ) {
    add({
      id: 'perf-cache',
      pillar: 'performance',
      severity: 'low',
      title: 'No caching layer',
      message: 'A web tier hitting a database directly can add avoidable latency and load.',
      fix: 'Add Azure Managed Redis to cache hot reads.',
    });
  }

  // ---- Cost --------------------------------------------------------------
  if (hasAny(['vm', 'vmss'])) {
    add({
      id: 'cost-reservations',
      pillar: 'cost',
      severity: 'low',
      title: 'Steady-state compute at pay-as-you-go',
      message: 'Always-on virtual machines are usually cheaper on a commitment.',
      fix: 'Evaluate Reserved Instances or a Savings Plan for steady-state VMs.',
      serviceIds: present(['vm', 'vmss']),
    });
  }

  // ---- Operational Excellence -------------------------------------------
  if (diagram.nodes.length > 0 && !has('app-insights')) {
    add({
      id: 'ops-app-insights',
      pillar: 'operational',
      severity: 'medium',
      title: 'No application monitoring',
      message:
        'There is no Application Insights resource to capture traces, metrics, and failures.',
      fix: 'Add Application Insights and instrument the workloads.',
    });
  }
  if (diagram.nodes.length > 0 && !has('log-analytics')) {
    add({
      id: 'ops-log-analytics',
      pillar: 'operational',
      severity: 'low',
      title: 'No centralized logs',
      message: 'Platform and diagnostic logs have no Log Analytics workspace to land in.',
      fix: 'Add a Log Analytics workspace and route diagnostic settings to it.',
    });
  }

  return { findings, ...score(findings) };
}

function score(findings: WafFinding[]): {
  scoreByPillar: Record<WafPillar, number>;
  overallScore: number;
} {
  const scoreByPillar = Object.fromEntries(WAF_PILLARS.map((p) => [p, 100])) as Record<
    WafPillar,
    number
  >;
  for (const f of findings) {
    scoreByPillar[f.pillar] = Math.max(0, scoreByPillar[f.pillar] - SEVERITY_PENALTY[f.severity]);
  }
  const overallScore = Math.round(
    WAF_PILLARS.reduce((sum, p) => sum + scoreByPillar[p], 0) / WAF_PILLARS.length,
  );
  return { scoreByPillar, overallScore };
}
