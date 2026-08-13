import { getServiceDefinition, type ServiceCategory } from './catalog.js';
import type { Diagram, NodeProperties, ResiliencyTarget } from './schema.js';

/**
 * Resiliency analysis — composite SLA, weakest link, and RTO/RPO for a design.
 *
 * Figures below are curated from the SLA for Microsoft Online Services and the
 * Azure reliability guides. They are representative planning inputs, NOT a
 * contractual commitment: SLA coverage is narrower than a service as a whole,
 * so a real SLO is usually lower (see the Well-Architected "adjusted SLO"
 * guidance). Every profile carries provenance so grounded refreshes from
 * Microsoft Learn can replace a baseline value and show where it came from.
 */

/** How much of a region-level failure a resource can survive. */
export type ResilienceTier = 'global' | 'nonzonal' | 'zoneRedundant' | 'multiRegion';

export type SlaConfidence = 'published' | 'derived' | 'estimated';

export interface SlaSource {
  kind: 'baseline' | 'learn';
  url?: string;
  /** Date a baseline figure was last checked against its source. */
  verifiedOn?: string;
  /** Date a grounded figure was retrieved from Microsoft Learn. */
  retrievedAt?: string;
  confidence: SlaConfidence;
}

export interface SlaProfile {
  serviceId: string;
  tier: ResilienceTier;
  slaPercent: number;
  /** Minutes; null when Microsoft does not publish a figure for the service. */
  rtoMinutes: number | null;
  rpoMinutes: number | null;
  /** What the SLA covers, or what the tier assumes. */
  basis: string;
  source: SlaSource;
}

/** Which gate stopped a node from reaching the tier the user asked for. */
export interface SlaBlock {
  gate: 'region' | 'service';
  message: string;
}

export interface ResolvedSla {
  profile: SlaProfile;
  requestedTier: ResilienceTier;
  blocked: SlaBlock | null;
}

export type ResiliencySeverity = 'high' | 'medium' | 'low';

export interface ResiliencyFinding {
  id: string;
  severity: ResiliencySeverity;
  title: string;
  message: string;
  fix: string;
  /** Diagram node ids the finding relates to, when applicable. */
  nodeIds?: string[];
}

export interface NodeResiliency {
  nodeId: string;
  serviceId: string;
  label: string;
  profile: SlaProfile;
  requestedTier: ResilienceTier;
  blocked: SlaBlock | null;
  /** False when the node is excluded from the composite calculation. */
  onCriticalPath: boolean;
  /** Null when there is no target set. */
  meetsTarget: boolean | null;
}

export interface ResiliencyReport {
  /** Every node, worst SLA first. */
  nodes: NodeResiliency[];
  /** Product of the critical-path node SLAs. 100 when nothing contributes. */
  compositeSlaPercent: number;
  downtimePerMonthMinutes: number;
  /** Lowest-SLA critical-path node, or null for an empty design. */
  weakestLink: NodeResiliency | null;
  /** Worst published figures across the critical path; null when none publish one. */
  worstRtoMinutes: number | null;
  worstRpoMinutes: number | null;
  target: ResiliencyTarget | null;
  meetsTarget: boolean;
  findings: ResiliencyFinding[];
  region: string;
  regionHasZones: boolean;
  /** Nodes left out of the composite (supporting services, or opted out). */
  excludedNodeIds: string[];
}

/** How a service's zone redundancy is actually switched on. */
export type ZoneRedundancyRule =
  | { kind: 'none' }
  | { kind: 'flag' }
  | { kind: 'sku'; property: string; zrsSkus: string[] }
  | { kind: 'flagAndInstances'; property: string; minInstances: number }
  | { kind: 'flagAndTier'; property: string; tiers: string[] };

interface TierSla {
  slaPercent: number;
  rtoMinutes?: number | null;
  rpoMinutes?: number | null;
  basis: string;
  confidence?: SlaConfidence;
}

interface ServiceResilience {
  /** Region- and zone-independent (Front Door, Entra ID, Static Web Apps). */
  global?: boolean;
  zoneRedundancy: ZoneRedundancyRule;
  /** True when the service can be configured for cross-region failover. */
  multiRegion?: boolean;
  /** SLA per achievable tier. `nonzonal` (or `global`) is always the floor. */
  tiers: Partial<Record<ResilienceTier, TierSla>>;
}

/** Legal source of record for Azure SLA percentages. */
export const SLA_SOURCE_URL =
  'https://www.microsoft.com/licensing/docs/view/Service-Level-Agreements-SLA-for-Online-Services';

/** Date the baseline table below was last reconciled against SLA_SOURCE_URL. */
export const SLA_BASELINE_VERIFIED_ON = '2026-08-11';

/**
 * Azure regions with availability zones, per
 * https://learn.microsoft.com/azure/reliability/availability-zones-overview
 */
export const AZ_REGIONS: ReadonlySet<string> = new Set([
  // Americas
  'brazilsouth',
  'canadacentral',
  'centralus',
  'chilecentral',
  'eastus',
  'eastus2',
  'mexicocentral',
  'southcentralus',
  'westus2',
  'westus3',
  // Europe
  'austriaeast',
  'belgiumcentral',
  'denmarkeast',
  'francecentral',
  'germanywestcentral',
  'italynorth',
  'northeurope',
  'norwayeast',
  'polandcentral',
  'spaincentral',
  'swedencentral',
  'switzerlandnorth',
  'uksouth',
  'westeurope',
  // Middle East
  'israelcentral',
  'qatarcentral',
  'uaenorth',
  // Africa
  'southafricanorth',
  // Asia Pacific
  'australiaeast',
  'centralindia',
  'eastasia',
  'indiasouthcentral',
  'indonesiacentral',
  'japaneast',
  'japanwest',
  'koreacentral',
  'malaysiawest',
  'newzealandnorth',
  'southeastasia',
]);

/** Date AZ_REGIONS was last checked; Azure adds availability-zone regions regularly. */
export const AZ_REGIONS_VERIFIED_ON = '2026-08-11';

/** Categories that support a workload rather than serve its requests. */
const SUPPORTING_CATEGORIES: ReadonlySet<ServiceCategory> = new Set<ServiceCategory>([
  'management',
  'identity',
  'devops',
]);

/** Data-tier services whose single-zone posture is called out per node. */
const DATA_TIER: ReadonlySet<string> = new Set([
  'sql-database',
  'cosmos-db',
  'postgresql',
  'redis',
  'storage-account',
]);

const SERVICE_RESILIENCE: Record<string, ServiceResilience> = {
  vm: {
    // A single VM can be zonal, but never zone-redundant.
    zoneRedundancy: { kind: 'none' },
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Single VM with premium storage' },
    },
  },
  vmss: {
    zoneRedundancy: { kind: 'flagAndInstances', property: 'instances', minInstances: 2 },
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Scale set in a single zone' },
      zoneRedundant: { slaPercent: 99.99, basis: 'Two or more instances across zones' },
    },
  },
  functions: {
    zoneRedundancy: { kind: 'flag' },
    multiRegion: true,
    tiers: {
      nonzonal: { slaPercent: 99.95, basis: 'Function execution' },
      zoneRedundant: { slaPercent: 99.99, basis: 'Zone-redundant plan' },
      multiRegion: { slaPercent: 99.99, basis: 'Paired regions behind a global router' },
    },
  },
  'container-apps': {
    zoneRedundancy: { kind: 'flag' },
    tiers: {
      nonzonal: { slaPercent: 99.95, basis: 'Requests via built-in ingress' },
      zoneRedundant: { slaPercent: 99.99, basis: 'Zone-redundant environment' },
    },
  },
  aks: {
    zoneRedundancy: { kind: 'flagAndTier', property: 'tier', tiers: ['Standard', 'Premium'] },
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'API server, single zone' },
      zoneRedundant: { slaPercent: 99.95, basis: 'Standard tier with node pools across zones' },
    },
  },
  'container-registry': {
    zoneRedundancy: { kind: 'flagAndTier', property: 'sku', tiers: ['Premium'] },
    multiRegion: true,
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Registry requests' },
      zoneRedundant: { slaPercent: 99.9, basis: 'Premium with zone redundancy' },
      multiRegion: { slaPercent: 99.95, basis: 'Premium with geo-replication' },
    },
  },
  'app-service': {
    // Availability is a property of the plan the app runs on.
    zoneRedundancy: { kind: 'none' },
    tiers: {
      nonzonal: { slaPercent: 99.95, basis: 'Inherited from the App Service Plan' },
    },
  },
  'app-service-plan': {
    zoneRedundancy: { kind: 'flagAndInstances', property: 'capacity', minInstances: 2 },
    tiers: {
      nonzonal: { slaPercent: 99.95, basis: 'Standard or higher, multiple instances' },
      zoneRedundant: { slaPercent: 99.99, basis: 'Zone-redundant plan, two or more instances' },
    },
  },
  'static-web-app': {
    global: true,
    zoneRedundancy: { kind: 'none' },
    tiers: {
      global: { slaPercent: 99.95, basis: 'Standard tier, globally distributed' },
    },
  },
  'api-management': {
    zoneRedundancy: { kind: 'flagAndTier', property: 'sku', tiers: ['Premium'] },
    multiRegion: true,
    tiers: {
      nonzonal: { slaPercent: 99.95, basis: 'Gateway requests, single unit' },
      zoneRedundant: { slaPercent: 99.99, basis: 'Premium across two or more zones' },
      multiRegion: { slaPercent: 99.99, basis: 'Premium multi-region deployment' },
    },
  },
  'sql-database': {
    zoneRedundancy: {
      kind: 'flagAndTier',
      property: 'tier',
      tiers: ['GeneralPurpose', 'BusinessCritical', 'Premium'],
    },
    multiRegion: true,
    tiers: {
      nonzonal: {
        slaPercent: 99.99,
        rtoMinutes: 30,
        rpoMinutes: 5,
        basis: 'Connectivity; point-in-time restore',
        confidence: 'published',
      },
      zoneRedundant: {
        slaPercent: 99.995,
        rtoMinutes: 30,
        rpoMinutes: 5,
        basis: 'Business Critical, zone redundant',
        confidence: 'published',
      },
      multiRegion: {
        slaPercent: 99.995,
        rtoMinutes: 60,
        rpoMinutes: 5,
        basis: 'Active geo-replication / failover group',
        confidence: 'published',
      },
    },
  },
  'cosmos-db': {
    zoneRedundancy: { kind: 'flag' },
    multiRegion: true,
    tiers: {
      nonzonal: { slaPercent: 99.99, rpoMinutes: 5, basis: 'Single-region account' },
      zoneRedundant: { slaPercent: 99.995, rpoMinutes: 5, basis: 'Single region with zone redundancy' },
      multiRegion: { slaPercent: 99.999, rpoMinutes: 0, basis: 'Multi-region reads and writes' },
    },
  },
  postgresql: {
    zoneRedundancy: { kind: 'flag' },
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Flexible Server, no high availability' },
      zoneRedundant: { slaPercent: 99.99, rtoMinutes: 2, basis: 'Zone-redundant high availability' },
    },
  },
  redis: {
    zoneRedundancy: {
      kind: 'flagAndTier',
      property: 'sku',
      tiers: ['Premium', 'Enterprise', 'Balanced_B1', 'MemoryOptimized', 'ComputeOptimized'],
    },
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Cache connectivity' },
      zoneRedundant: { slaPercent: 99.99, basis: 'Replica across zones' },
    },
  },
  'storage-account': {
    // Zone redundancy is the replication SKU, not a separate switch.
    zoneRedundancy: {
      kind: 'sku',
      property: 'sku',
      zrsSkus: ['Standard_ZRS', 'Standard_GZRS', 'Standard_RAGZRS', 'Premium_ZRS'],
    },
    multiRegion: true,
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'LRS read and write requests' },
      zoneRedundant: { slaPercent: 99.9, basis: 'ZRS, three zones in one region' },
      multiRegion: { slaPercent: 99.99, rpoMinutes: 15, basis: 'RA-GRS read requests' },
    },
  },
  vnet: {
    zoneRedundancy: { kind: 'none' },
    tiers: {
      nonzonal: { slaPercent: 99.99, basis: 'Virtual network availability' },
    },
  },
  'load-balancer': {
    zoneRedundancy: { kind: 'flag' },
    tiers: {
      nonzonal: { slaPercent: 99.99, basis: 'Standard load balancer data path' },
      zoneRedundant: { slaPercent: 99.99, basis: 'Zone-redundant frontend' },
    },
  },
  'application-gateway': {
    zoneRedundancy: { kind: 'flagAndInstances', property: 'capacity', minInstances: 2 },
    tiers: {
      nonzonal: { slaPercent: 99.95, basis: 'v2 with two or more instances' },
      zoneRedundant: { slaPercent: 99.95, basis: 'v2 spread across zones' },
    },
  },
  'front-door': {
    global: true,
    zoneRedundancy: { kind: 'none' },
    tiers: {
      global: { slaPercent: 99.99, basis: 'Global HTTP request routing' },
    },
  },
  'private-endpoint': {
    zoneRedundancy: { kind: 'none' },
    tiers: {
      nonzonal: { slaPercent: 99.99, basis: 'Private Link data path' },
    },
  },
  'azure-openai': {
    zoneRedundancy: { kind: 'none' },
    multiRegion: true,
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Inference requests' },
      multiRegion: { slaPercent: 99.95, basis: 'Multiple deployments behind a router' },
    },
  },
  'ai-search': {
    zoneRedundancy: { kind: 'flagAndInstances', property: 'replicas', minInstances: 3 },
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Query requests, two or more replicas' },
      zoneRedundant: { slaPercent: 99.9, basis: 'Three or more replicas across zones' },
    },
  },
  'ai-foundry': {
    zoneRedundancy: { kind: 'none' },
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Project and agent endpoints', confidence: 'estimated' },
    },
  },
  'event-hubs': {
    zoneRedundancy: {
      kind: 'flagAndTier',
      property: 'sku',
      tiers: ['Standard', 'Premium', 'Dedicated'],
    },
    multiRegion: true,
    tiers: {
      nonzonal: { slaPercent: 99.95, basis: 'Send and receive operations' },
      zoneRedundant: { slaPercent: 99.99, basis: 'Zone-redundant namespace' },
      multiRegion: { slaPercent: 99.99, basis: 'Geo-disaster recovery pairing' },
    },
  },
  'data-explorer': {
    zoneRedundancy: { kind: 'flag' },
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Cluster query availability' },
      zoneRedundant: { slaPercent: 99.9, basis: 'Cluster spread across zones' },
    },
  },
  'service-bus': {
    zoneRedundancy: { kind: 'flagAndTier', property: 'sku', tiers: ['Premium'] },
    multiRegion: true,
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Send and receive operations' },
      zoneRedundant: { slaPercent: 99.9, basis: 'Premium, zone-redundant namespace' },
      multiRegion: { slaPercent: 99.99, basis: 'Geo-disaster recovery pairing' },
    },
  },
  'logic-apps': {
    zoneRedundancy: { kind: 'flag' },
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Workflow execution' },
      zoneRedundant: { slaPercent: 99.99, basis: 'Zone-redundant Standard workflow' },
    },
  },
  'key-vault': {
    // Zone redundancy is applied by the platform in supported regions.
    zoneRedundancy: { kind: 'none' },
    tiers: {
      nonzonal: { slaPercent: 99.99, basis: 'Vault transactions' },
    },
  },
  'managed-identity': {
    global: true,
    zoneRedundancy: { kind: 'none' },
    tiers: {
      global: { slaPercent: 99.99, basis: 'Token issuance', confidence: 'derived' },
    },
  },
  'entra-id': {
    global: true,
    zoneRedundancy: { kind: 'none' },
    tiers: {
      global: { slaPercent: 99.99, basis: 'Authentication requests' },
    },
  },
  'log-analytics': {
    zoneRedundancy: { kind: 'flag' },
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Log ingestion and query' },
      zoneRedundant: { slaPercent: 99.9, basis: 'Workspace in a zone-redundant region' },
    },
  },
  'app-insights': {
    zoneRedundancy: { kind: 'none' },
    tiers: {
      nonzonal: { slaPercent: 99.9, basis: 'Telemetry ingestion' },
    },
  },
};

/** True when the region has availability zones. */
export function regionSupportsZones(region: string): boolean {
  return AZ_REGIONS.has(region.trim().toLowerCase().replace(/\s+/g, ''));
}

/** Expected downtime in minutes over a 30-day month for an SLA percentage. */
export function slaToDowntimeMinutes(slaPercent: number): number {
  return Math.round((1 - slaPercent / 100) * 43_200 * 10) / 10;
}

/** Multiplicative composite SLA, as recommended by the Well-Architected Framework. */
export function compositeSla(slaPercents: number[]): number {
  if (slaPercents.length === 0) return 100;
  const product = slaPercents.reduce((acc, p) => acc * (p / 100), 1);
  return Math.round(product * 100 * 10_000) / 10_000;
}

function boolProp(props: NodeProperties, key: string): boolean {
  const v = props[key];
  return v === true || v === 'true';
}

function numProp(props: NodeProperties, key: string, fallback: number): number {
  const v = props[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function strProp(props: NodeProperties, key: string): string {
  const v = props[key];
  return typeof v === 'string' ? v : '';
}

/** Why the service configuration cannot support zone redundancy, or null if it can. */
function zoneRedundancyBlocker(
  rule: ZoneRedundancyRule,
  props: NodeProperties,
  serviceName: string,
): string | null {
  switch (rule.kind) {
    case 'none':
      return `${serviceName} does not offer a zone-redundant configuration here.`;
    case 'flag':
      return null;
    case 'sku': {
      const sku = strProp(props, rule.property);
      return rule.zrsSkus.includes(sku)
        ? null
        : `${serviceName} needs a zone-redundant ${rule.property} (${rule.zrsSkus.join(', ')}); it is set to "${sku || 'unset'}".`;
    }
    case 'flagAndInstances': {
      const count = numProp(props, rule.property, 1);
      return count >= rule.minInstances
        ? null
        : `${serviceName} needs at least ${rule.minInstances} ${rule.property} to span zones; it has ${count}.`;
    }
    case 'flagAndTier': {
      const tier = strProp(props, rule.property);
      return rule.tiers.includes(tier)
        ? null
        : `${serviceName} needs ${rule.property} to be one of ${rule.tiers.join(', ')}; it is "${tier || 'unset'}".`;
    }
  }
}

function toProfile(
  serviceId: string,
  tier: ResilienceTier,
  sla: TierSla,
  overrides: SlaProfile[] | undefined,
): SlaProfile {
  const override = overrides?.find((o) => o.serviceId === serviceId && o.tier === tier);
  if (override) return override;
  return {
    serviceId,
    tier,
    slaPercent: sla.slaPercent,
    rtoMinutes: sla.rtoMinutes ?? null,
    rpoMinutes: sla.rpoMinutes ?? null,
    basis: sla.basis,
    source: {
      kind: 'baseline',
      url: SLA_SOURCE_URL,
      verifiedOn: SLA_BASELINE_VERIFIED_ON,
      confidence: sla.confidence ?? 'published',
    },
  };
}

const UNKNOWN_SERVICE_SLA: TierSla = {
  slaPercent: 99.9,
  basis: 'No published figure; assumed single-region default',
  confidence: 'estimated',
};

/**
 * Resolve the SLA a node actually achieves. Zone redundancy requires all three
 * of: an availability-zone region, a service/SKU that supports it, and the user
 * opting in. When a gate fails the tier is downgraded and `blocked` explains why.
 */
export function resolveNodeSla(
  serviceId: string,
  properties: NodeProperties,
  region: string,
  overrides?: SlaProfile[],
): ResolvedSla {
  const entry = SERVICE_RESILIENCE[serviceId];
  const serviceName = getServiceDefinition(serviceId)?.name ?? serviceId;

  if (!entry) {
    return {
      profile: toProfile(serviceId, 'nonzonal', UNKNOWN_SERVICE_SLA, overrides),
      requestedTier: 'nonzonal',
      blocked: null,
    };
  }

  if (entry.global) {
    const sla = entry.tiers.global ?? UNKNOWN_SERVICE_SLA;
    return {
      profile: toProfile(serviceId, 'global', sla, overrides),
      requestedTier: 'global',
      blocked: null,
    };
  }

  const wantsMultiRegion = boolProp(properties, 'multiRegion');
  if (wantsMultiRegion && entry.multiRegion && entry.tiers.multiRegion) {
    return {
      profile: toProfile(serviceId, 'multiRegion', entry.tiers.multiRegion, overrides),
      requestedTier: 'multiRegion',
      blocked: null,
    };
  }

  const nonzonal = toProfile(
    serviceId,
    'nonzonal',
    entry.tiers.nonzonal ?? UNKNOWN_SERVICE_SLA,
    overrides,
  );

  if (wantsMultiRegion && !entry.multiRegion) {
    return {
      profile: nonzonal,
      requestedTier: 'multiRegion',
      blocked: {
        gate: 'service',
        message: `${serviceName} has no multi-region configuration in this model.`,
      },
    };
  }

  const wantsZoneRedundant = boolProp(properties, 'zoneRedundant');
  if (!wantsZoneRedundant) return { profile: nonzonal, requestedTier: 'nonzonal', blocked: null };

  if (!regionSupportsZones(region)) {
    return {
      profile: nonzonal,
      requestedTier: 'zoneRedundant',
      blocked: {
        gate: 'region',
        message: `Region "${region}" has no availability zones, so zone redundancy cannot apply.`,
      },
    };
  }

  const serviceBlocker = zoneRedundancyBlocker(entry.zoneRedundancy, properties, serviceName);
  if (serviceBlocker || !entry.tiers.zoneRedundant) {
    return {
      profile: nonzonal,
      requestedTier: 'zoneRedundant',
      blocked: {
        gate: 'service',
        message: serviceBlocker ?? `${serviceName} has no zone-redundant SLA in this model.`,
      },
    };
  }

  return {
    profile: toProfile(serviceId, 'zoneRedundant', entry.tiers.zoneRedundant, overrides),
    requestedTier: 'zoneRedundant',
    blocked: null,
  };
}

export interface ResiliencyOptions {
  /** Overrides the diagram's own target, e.g. from an unsaved panel edit. */
  target?: ResiliencyTarget | null;
  /** Grounded profiles that replace baseline values for matching service+tier. */
  overrides?: SlaProfile[];
}

/** Nodes in supporting categories don't gate request-path availability. */
function isCriticalPath(serviceId: string, properties: NodeProperties): boolean {
  if (boolProp(properties, 'excludeFromSla')) return false;
  const category = getServiceDefinition(serviceId)?.category;
  return !category || !SUPPORTING_CATEGORIES.has(category);
}

function worstOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : Math.max(...present);
}

/** True when a scalable service runs below the instance count needed to span zones. */
function belowRedundantInstanceCount(serviceId: string, properties: NodeProperties): boolean {
  const rule = SERVICE_RESILIENCE[serviceId]?.zoneRedundancy;
  if (rule?.kind !== 'flagAndInstances') return false;
  return numProp(properties, rule.property, 1) < rule.minInstances;
}

/**
 * Evaluate a diagram's composite availability and recovery posture. Pure and
 * deterministic so results are stable and testable; grounded Learn figures come
 * in through `options.overrides`.
 */
export function analyzeResiliency(diagram: Diagram, options: ResiliencyOptions = {}): ResiliencyReport {
  const region = diagram.metadata.region || 'eastus2';
  const regionHasZones = regionSupportsZones(region);
  const target = options.target ?? diagram.metadata.resiliency ?? null;

  const nodes: NodeResiliency[] = diagram.nodes.map((n) => {
    const resolved = resolveNodeSla(n.serviceId, n.properties, region, options.overrides);
    const onCriticalPath = isCriticalPath(n.serviceId, n.properties);
    return {
      nodeId: n.id,
      serviceId: n.serviceId,
      label: n.label || n.serviceId,
      profile: resolved.profile,
      requestedTier: resolved.requestedTier,
      blocked: resolved.blocked,
      onCriticalPath,
      meetsTarget: target ? resolved.profile.slaPercent >= target.slaPercent : null,
    };
  });

  nodes.sort((a, b) => a.profile.slaPercent - b.profile.slaPercent);

  const critical = nodes.filter((n) => n.onCriticalPath);
  const compositeSlaPercent = compositeSla(critical.map((n) => n.profile.slaPercent));
  const worstRtoMinutes = worstOrNull(critical.map((n) => n.profile.rtoMinutes));
  const worstRpoMinutes = worstOrNull(critical.map((n) => n.profile.rpoMinutes));

  const singleInstanceNodeIds = diagram.nodes
    .filter((n) => isCriticalPath(n.serviceId, n.properties) && belowRedundantInstanceCount(n.serviceId, n.properties))
    .map((n) => n.id);

  const findings = buildFindings({
    nodes,
    critical,
    compositeSlaPercent,
    worstRtoMinutes,
    worstRpoMinutes,
    target,
    region,
    regionHasZones,
    singleInstanceNodeIds,
  });

  const meetsTarget =
    !target ||
    (compositeSlaPercent >= target.slaPercent &&
      (worstRtoMinutes === null || worstRtoMinutes <= target.rtoMinutes) &&
      (worstRpoMinutes === null || worstRpoMinutes <= target.rpoMinutes));

  return {
    nodes,
    compositeSlaPercent,
    downtimePerMonthMinutes: slaToDowntimeMinutes(compositeSlaPercent),
    weakestLink: critical[0] ?? null,
    worstRtoMinutes,
    worstRpoMinutes,
    target,
    meetsTarget,
    findings,
    region,
    regionHasZones,
    excludedNodeIds: nodes.filter((n) => !n.onCriticalPath).map((n) => n.nodeId),
  };
}

function buildFindings(ctx: {
  nodes: NodeResiliency[];
  critical: NodeResiliency[];
  compositeSlaPercent: number;
  worstRtoMinutes: number | null;
  worstRpoMinutes: number | null;
  target: ResiliencyTarget | null;
  region: string;
  regionHasZones: boolean;
  singleInstanceNodeIds: string[];
}): ResiliencyFinding[] {
  const findings: ResiliencyFinding[] = [];
  const { nodes, critical, target } = ctx;
  if (nodes.length === 0) return findings;

  const blockedByRegion = nodes.filter((n) => n.blocked?.gate === 'region');
  if (blockedByRegion.length > 0) {
    findings.push({
      id: 'res-zone-region',
      severity: 'high',
      title: 'Zone redundancy requested in a region without zones',
      message: `${blockedByRegion.length} resource(s) are configured as zone-redundant, but "${ctx.region}" has no availability zones. They are running as single-zone.`,
      fix: 'Move the workload to a region with availability zones, or drop the zone-redundancy assumption from the design.',
      nodeIds: blockedByRegion.map((n) => n.nodeId),
    });
  }

  const blockedByService = nodes.filter((n) => n.blocked?.gate === 'service');
  if (blockedByService.length > 0) {
    findings.push({
      id: 'res-zone-config',
      severity: 'medium',
      title: 'Configuration does not support the requested redundancy',
      message: blockedByService.map((n) => `${n.label}: ${n.blocked?.message}`).join(' '),
      fix: 'Change the SKU, tier, or instance count so the service can span zones or regions.',
      nodeIds: blockedByService.map((n) => n.nodeId),
    });
  }

  if (target && ctx.compositeSlaPercent < target.slaPercent) {
    findings.push({
      id: 'res-target-sla',
      severity: 'high',
      title: 'Composite SLA is below target',
      message: `The design computes to ${ctx.compositeSlaPercent}% (${slaToDowntimeMinutes(ctx.compositeSlaPercent)} min/month) against a ${target.slaPercent}% target.`,
      fix: 'Raise the weakest components to a zone-redundant or multi-region tier, or remove non-essential services from the request path.',
      nodeIds: critical.slice(0, 3).map((n) => n.nodeId),
    });
  }

  if (target && ctx.worstRtoMinutes !== null && ctx.worstRtoMinutes > target.rtoMinutes) {
    findings.push({
      id: 'res-target-rto',
      severity: 'medium',
      title: 'Recovery time exceeds target',
      message: `Worst published RTO is ${ctx.worstRtoMinutes} min against a ${target.rtoMinutes} min target.`,
      fix: 'Add a failover replica or a warm standby for the slowest component to recover.',
    });
  }

  if (target && ctx.worstRpoMinutes !== null && ctx.worstRpoMinutes > target.rpoMinutes) {
    findings.push({
      id: 'res-target-rpo',
      severity: 'medium',
      title: 'Data loss window exceeds target',
      message: `Worst published RPO is ${ctx.worstRpoMinutes} min against a ${target.rpoMinutes} min target.`,
      fix: 'Enable geo-replication or shorten the backup interval on the data services.',
    });
  }

  const zoneRedundant = critical.filter((n) => n.profile.tier === 'zoneRedundant');
  if (ctx.regionHasZones && critical.length > 0 && zoneRedundant.length === 0) {
    findings.push({
      id: 'res-no-zone-redundancy',
      severity: 'medium',
      title: 'No component uses availability zones',
      message: `"${ctx.region}" supports availability zones, but nothing in the design is zone-redundant. A single datacentre fault takes the workload down.`,
      fix: 'Enable zone redundancy on the compute and data tiers.',
      nodeIds: critical.map((n) => n.nodeId),
    });
  }

  const singleVms = nodes.filter((n) => n.serviceId === 'vm');
  if (singleVms.length > 0) {
    findings.push({
      id: 'res-single-vm',
      severity: 'medium',
      title: 'Single virtual machine caps availability at 99.9%',
      message: 'A standalone VM cannot be zone-redundant, so it becomes the ceiling for the whole design.',
      fix: 'Use a VM Scale Set across two or more availability zones.',
      nodeIds: singleVms.map((n) => n.nodeId),
    });
  }

  const singleInstance = nodes.filter((n) => ctx.singleInstanceNodeIds.includes(n.nodeId));
  if (singleInstance.length > 0) {
    findings.push({
      id: 'res-single-instance',
      severity: 'medium',
      title: 'Scalable service runs too few instances to span zones',
      message: `${singleInstance
        .map((n) => n.label)
        .join(', ')} run below the instance count needed to spread across availability zones, so a single instance failure takes the tier down.`,
      fix: 'Raise the instance, capacity, or replica count to the service\u2019s zone-redundant minimum and spread it across zones.',
      nodeIds: singleInstance.map((n) => n.nodeId),
    });
  }

  const singleZoneData = critical.filter(
    (n) => DATA_TIER.has(n.serviceId) && n.profile.tier === 'nonzonal',
  );
  if (singleZoneData.length > 0) {
    findings.push({
      id: 'res-single-zone-data',
      severity: 'medium',
      title: 'Data tier lives in a single zone',
      message: `${singleZoneData
        .map((n) => n.label)
        .join(', ')} are not zone-redundant, so a single datacentre fault can take the data offline and risk the last writes.`,
      fix: ctx.regionHasZones
        ? 'Enable zone redundancy (and geo-replication for regional cover) on the data tier.'
        : 'Move the data tier to a region with availability zones, then enable zone redundancy or geo-replication.',
      nodeIds: singleZoneData.map((n) => n.nodeId),
    });
  }

  const multiRegion = critical.filter((n) => n.profile.tier === 'multiRegion');
  if (critical.length > 0 && multiRegion.length === 0) {
    findings.push({
      id: 'res-single-region',
      severity: 'low',
      title: 'Design is single-region',
      message: 'Nothing in the design fails over to another region, so a regional outage is unrecoverable within the SLA.',
      fix: 'Add geo-replication or a paired-region deployment for the data and entry tiers.',
    });
  }

  return findings;
}
