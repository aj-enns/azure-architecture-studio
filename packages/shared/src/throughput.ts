import { getServiceDefinition } from './catalog.js';
import { regionCostMultiplier } from './pricing.js';
import type { Diagram, DiagramNode } from './schema.js';

/**
 * Throughput capacity model — mirrors the resiliency review, but for load. Each
 * request-serving service has a curated, order-of-magnitude requests/min figure
 * per unit of its scaling dimension (instances, replicas, throughput units, …),
 * enough to spot the bottleneck resource and size it against a target, NOT a
 * benchmarked guarantee. Services not listed here are treated as non-gating
 * (global/elastic front doors, caches, serverless) and never bottleneck.
 */
interface ThroughputModelEntry {
  /** Requests/min one unit serves at a representative production SKU. */
  rpmPerUnit: number;
  /** node.properties key holding the unit count for this service. */
  scaleProperty: string;
  /** Unit count assumed when the property is absent (mirrors catalog defaults). */
  defaultUnits: number;
  /** Smallest supported unit count. */
  minUnits: number;
  /** Largest unit count a scale-up recommendation may suggest. */
  maxUnits: number;
  /** Added monthly USD per extra unit in East US 2 (scaled by region). */
  perUnitMonthlyUsd: number;
  /** Short note on what one unit represents. */
  basis: string;
}

/** Curated per-service throughput baseline keyed by catalog serviceId. */
const SERVICE_THROUGHPUT: Record<string, ThroughputModelEntry> = {
  'app-service-plan': { rpmPerUnit: 9000, scaleProperty: 'capacity', defaultUnits: 1, minUnits: 1, maxUnits: 30, perUnitMonthlyUsd: 120, basis: 'P1v3 instance' },
  'container-apps': { rpmPerUnit: 6000, scaleProperty: 'maxReplicas', defaultUnits: 10, minUnits: 1, maxUnits: 300, perUnitMonthlyUsd: 10, basis: 'replica' },
  aks: { rpmPerUnit: 12000, scaleProperty: 'nodeCount', defaultUnits: 3, minUnits: 1, maxUnits: 100, perUnitMonthlyUsd: 70, basis: 'D4s v5 node' },
  vmss: { rpmPerUnit: 6000, scaleProperty: 'instances', defaultUnits: 2, minUnits: 1, maxUnits: 100, perUnitMonthlyUsd: 70, basis: 'D2s v5 instance' },
  vm: { rpmPerUnit: 6000, scaleProperty: 'instances', defaultUnits: 1, minUnits: 1, maxUnits: 1, perUnitMonthlyUsd: 70, basis: 'D2s v5 (single instance)' },
  'application-gateway': { rpmPerUnit: 3000, scaleProperty: 'capacity', defaultUnits: 2, minUnits: 2, maxUnits: 125, perUnitMonthlyUsd: 125, basis: 'WAF_v2 capacity unit' },
  'api-management': { rpmPerUnit: 30000, scaleProperty: 'capacity', defaultUnits: 1, minUnits: 1, maxUnits: 12, perUnitMonthlyUsd: 700, basis: 'Standard v2 unit' },
  'sql-database': { rpmPerUnit: 3000, scaleProperty: 'capacity', defaultUnits: 2, minUnits: 1, maxUnits: 80, perUnitMonthlyUsd: 130, basis: 'GP vCore' },
  postgresql: { rpmPerUnit: 3000, scaleProperty: 'capacity', defaultUnits: 2, minUnits: 1, maxUnits: 96, perUnitMonthlyUsd: 130, basis: 'GP vCore' },
  'event-hubs': { rpmPerUnit: 60000, scaleProperty: 'throughputUnits', defaultUnits: 1, minUnits: 1, maxUnits: 40, perUnitMonthlyUsd: 22, basis: 'throughput unit' },
};

/** Per-node throughput result: capability today and what it takes to hit target. */
export interface NodeThroughput {
  nodeId: string;
  serviceId: string;
  label: string;
  /** Requests/min this resource can serve as currently configured. */
  requestsPerMinute: number;
  scaleProperty: string;
  currentUnits: number;
  /** Units needed to meet target (>= currentUnits), clamped to the service max. */
  recommendedUnits: number;
  addedUnits: number;
  addedMonthlyUsd: number;
  /** True when the resource can serve the target as configured. */
  meetsTarget: boolean;
  /** True when even at max units the resource cannot reach the target. */
  capReached: boolean;
  basis: string;
}

export interface ThroughputReport {
  /** Request-serving nodes only, sorted weakest capability first. */
  nodes: NodeThroughput[];
  /** The lowest-capacity node — the design's throughput ceiling. */
  bottleneck: NodeThroughput | null;
  /** Requests/min the whole design can serve (the bottleneck's capability). */
  capacityPerMinute: number | null;
  /** Requests/min required (usersPerMinute × requestsPerUser), or null if unset. */
  targetPerMinute: number | null;
  /** True when no target is set, or the bottleneck meets it. */
  meetsTarget: boolean;
  /** Sum of scale-up cost across under-provisioned nodes. */
  totalAddedMonthlyUsd: number;
}

function unitCount(node: DiagramNode, key: string, fallback: number): number {
  const raw = node.properties[key];
  return typeof raw === 'number' && raw > 0 ? raw : fallback;
}

function estimateNode(node: DiagramNode, targetPerMinute: number | null, region: string): NodeThroughput | null {
  const model = SERVICE_THROUGHPUT[node.serviceId];
  if (!model) return null;

  const currentUnits = unitCount(node, model.scaleProperty, model.defaultUnits);
  const requestsPerMinute = Math.round(model.rpmPerUnit * currentUnits);

  let recommendedUnits = currentUnits;
  let capReached = false;
  if (targetPerMinute !== null && requestsPerMinute < targetPerMinute) {
    const needed = Math.ceil(targetPerMinute / model.rpmPerUnit);
    recommendedUnits = Math.min(model.maxUnits, Math.max(model.minUnits, needed, currentUnits));
    capReached = recommendedUnits * model.rpmPerUnit < targetPerMinute;
  }

  const addedUnits = Math.max(0, recommendedUnits - currentUnits);
  const addedMonthlyUsd = Math.round(addedUnits * model.perUnitMonthlyUsd * regionCostMultiplier(region));

  return {
    nodeId: node.id,
    serviceId: node.serviceId,
    label: node.label || getServiceDefinition(node.serviceId)?.name || node.serviceId,
    requestsPerMinute,
    scaleProperty: model.scaleProperty,
    currentUnits,
    recommendedUnits,
    addedUnits,
    addedMonthlyUsd,
    meetsTarget: targetPerMinute === null ? true : requestsPerMinute >= targetPerMinute,
    capReached,
    basis: model.basis,
  };
}

/** Analyze the diagram's request-serving capacity against its throughput target. */
export function analyzeThroughput(diagram: Diagram): ThroughputReport {
  const region = diagram.metadata.region || 'eastus2';
  const target = diagram.metadata.throughput;
  const targetPerMinute = target ? Math.round(target.usersPerMinute * target.requestsPerUser) : null;

  const nodes = diagram.nodes
    .map((n) => estimateNode(n, targetPerMinute, region))
    .filter((n): n is NodeThroughput => n !== null)
    .sort((a, b) => a.requestsPerMinute - b.requestsPerMinute);

  const bottleneck = nodes[0] ?? null;
  const capacityPerMinute = bottleneck ? bottleneck.requestsPerMinute : null;
  const meetsTarget =
    targetPerMinute === null || (capacityPerMinute !== null && capacityPerMinute >= targetPerMinute);
  const totalAddedMonthlyUsd = nodes.reduce((sum, n) => sum + n.addedMonthlyUsd, 0);

  return { nodes, bottleneck, capacityPerMinute, targetPerMinute, meetsTarget, totalAddedMonthlyUsd };
}
