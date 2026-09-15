import { getServiceDefinition, isExternalServiceId, type ServiceCategory } from './catalog.js';
import type { Diagram } from './schema.js';

/**
 * Representative monthly cost estimate for a service. These are curated,
 * order-of-magnitude figures for a common small-production SKU in East US 2 —
 * enough to compare designs and spot cost drivers, NOT a billing quote. A live
 * Azure Retail Prices refinement can override these later.
 */
export interface CostEstimate {
  monthlyUsd: number;
  /** Short note on what the figure represents (SKU/tier or "usage-based"). */
  basis: string;
  /** True when the real cost depends on usage/throughput, not a fixed SKU. */
  usageBased: boolean;
}

interface CostModelEntry {
  monthlyUsd: number;
  basis: string;
  usageBased?: boolean;
}

/** Curated baseline monthly USD per catalog serviceId (East US 2). */
const COST_MODEL: Record<string, CostModelEntry> = {
  vm: { monthlyUsd: 70, basis: 'D2s v5, 730h' },
  vmss: { monthlyUsd: 140, basis: '2 × D2s v5' },
  functions: { monthlyUsd: 15, basis: 'Consumption', usageBased: true },
  'container-apps': { monthlyUsd: 30, basis: 'Consumption', usageBased: true },
  aks: { monthlyUsd: 220, basis: '3 × D4s v5 + Standard tier' },
  'container-registry': { monthlyUsd: 20, basis: 'Standard' },
  'app-service': { monthlyUsd: 0, basis: 'Billed via App Service Plan' },
  'app-service-plan': { monthlyUsd: 120, basis: 'P1v3, Linux' },
  'static-web-app': { monthlyUsd: 9, basis: 'Standard' },
  'api-management': { monthlyUsd: 50, basis: 'Developer' },
  'sql-database': { monthlyUsd: 30, basis: 'GP serverless, small', usageBased: true },
  'cosmos-db': { monthlyUsd: 25, basis: 'Serverless', usageBased: true },
  postgresql: { monthlyUsd: 130, basis: 'GP D2ds v5' },
  redis: { monthlyUsd: 55, basis: 'Balanced B1' },
  'storage-account': { monthlyUsd: 20, basis: 'Standard LRS', usageBased: true },
  vnet: { monthlyUsd: 0, basis: 'No base charge' },
  'load-balancer': { monthlyUsd: 20, basis: 'Standard + rules' },
  'application-gateway': { monthlyUsd: 250, basis: 'WAF_v2, 2 capacity units' },
  'front-door': { monthlyUsd: 40, basis: 'Standard base', usageBased: true },
  'private-endpoint': { monthlyUsd: 8, basis: '730h + data' },
  'azure-openai': { monthlyUsd: 50, basis: 'Token usage', usageBased: true },
  'ai-search': { monthlyUsd: 75, basis: 'Basic' },
  'ai-foundry': { monthlyUsd: 20, basis: 'Usage', usageBased: true },
  'event-hubs': { monthlyUsd: 22, basis: 'Standard, 1 TU' },
  'data-explorer': { monthlyUsd: 120, basis: 'Small cluster' },
  'service-bus': { monthlyUsd: 10, basis: 'Standard base' },
  'logic-apps': { monthlyUsd: 15, basis: 'Consumption', usageBased: true },
  'key-vault': { monthlyUsd: 3, basis: 'Operations', usageBased: true },
  'managed-identity': { monthlyUsd: 0, basis: 'Free' },
  'entra-id': { monthlyUsd: 0, basis: 'Free tier' },
  'log-analytics': { monthlyUsd: 15, basis: 'Ingestion', usageBased: true },
  'app-insights': { monthlyUsd: 10, basis: 'Ingestion', usageBased: true },
};

/** Rough regional cost multipliers relative to East US 2. */
const REGION_MULTIPLIER: Record<string, number> = {
  eastus2: 1.0,
  eastus: 1.0,
  westus2: 1.02,
  westus3: 1.02,
  centralus: 1.0,
  canadacentral: 1.05,
  brazilsouth: 1.2,
  mexicocentral: 1.08,
  westeurope: 1.08,
  northeurope: 1.06,
  swedencentral: 1.06,
  uksouth: 1.08,
  australiaeast: 1.12,
  southeastasia: 1.1,
  japaneast: 1.1,
};

function regionMultiplier(region: string): number {
  return REGION_MULTIPLIER[region.toLowerCase()] ?? 1.0;
}

/** Rough regional cost multiplier relative to East US 2 (1.0), for scaling estimates. */
export function regionCostMultiplier(region: string): number {
  return regionMultiplier(region);
}

/** Estimate the monthly cost of a single service in a region. */
export function estimateNodeCost(serviceId: string, region = 'eastus2'): CostEstimate {
  const entry = COST_MODEL[serviceId];
  if (!entry) return { monthlyUsd: 0, basis: 'No estimate', usageBased: true };
  return {
    monthlyUsd: Math.round(entry.monthlyUsd * regionMultiplier(region)),
    basis: entry.basis,
    usageBased: entry.usageBased ?? false,
  };
}

export interface DiagramCost {
  nodes: {
    id: string;
    serviceId: string;
    label: string;
    monthlyUsd: number;
    usageBased: boolean;
    /** True for non-Azure components, whose cost is not estimated. */
    external: boolean;
  }[];
  byCategory: { category: ServiceCategory; monthlyUsd: number }[];
  totalMonthlyUsd: number;
  /** True when any contributing service is usage-based (so the total is a floor). */
  hasUsageBased: boolean;
  /** True when the diagram contains non-Azure components excluded from the estimate. */
  hasExternalNodes: boolean;
  region: string;
}

/** Estimate the total monthly cost of a diagram, broken down by node and category. */
export function estimateDiagramCost(diagram: Diagram): DiagramCost {
  const region = diagram.metadata.region || 'eastus2';
  const nodes = diagram.nodes.map((n) => {
    const external = isExternalServiceId(n.serviceId);
    const est = external ? null : estimateNodeCost(n.serviceId, region);
    return {
      id: n.id,
      serviceId: n.serviceId,
      label: n.label || n.serviceId,
      monthlyUsd: est?.monthlyUsd ?? 0,
      usageBased: est?.usageBased ?? false,
      external,
    };
  });

  const catTotals = new Map<ServiceCategory, number>();
  for (const n of nodes) {
    const category = getServiceDefinition(n.serviceId)?.category;
    if (!category) continue;
    catTotals.set(category, (catTotals.get(category) ?? 0) + n.monthlyUsd);
  }

  return {
    nodes,
    byCategory: [...catTotals.entries()]
      .map(([category, monthlyUsd]) => ({ category, monthlyUsd }))
      .sort((a, b) => b.monthlyUsd - a.monthlyUsd),
    totalMonthlyUsd: nodes.reduce((sum, n) => sum + n.monthlyUsd, 0),
    hasUsageBased: nodes.some((n) => n.usageBased && n.monthlyUsd > 0),
    hasExternalNodes: nodes.some((n) => n.external),
    region,
  };
}
