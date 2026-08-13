import { describe, expect, it } from 'vitest';
import { azureServiceCatalog } from './catalog.js';
import { emptyDiagram, type Diagram, type NodeProperties } from './schema.js';
import {
  analyzeResiliency,
  compositeSla,
  describeNodeResiliency,
  regionSupportsZones,
  resolveNodeSla,
  slaToDowntimeMinutes,
} from './resiliency.js';

interface NodeSpec {
  serviceId: string;
  properties?: NodeProperties;
}

function diagramWith(specs: (string | NodeSpec)[], region = 'eastus2'): Diagram {
  const d = emptyDiagram('test');
  d.metadata.region = region;
  d.nodes = specs.map((spec, i) => {
    const { serviceId, properties } =
      typeof spec === 'string' ? { serviceId: spec, properties: {} } : spec;
    return {
      id: `n${i}`,
      serviceId,
      label: serviceId,
      position: { x: 0, y: 0 },
      properties: properties ?? {},
    };
  });
  return d;
}

describe('regionSupportsZones', () => {
  it('recognises availability-zone regions', () => {
    expect(regionSupportsZones('eastus2')).toBe(true);
    expect(regionSupportsZones('West Europe')).toBe(true);
  });

  it('rejects regions without availability zones', () => {
    expect(regionSupportsZones('westus')).toBe(false);
    expect(regionSupportsZones('canadaeast')).toBe(false);
  });
});

describe('sla arithmetic', () => {
  it('multiplies contributing SLAs', () => {
    expect(compositeSla([99.99, 99.99])).toBeCloseTo(99.98, 3);
    expect(compositeSla([])).toBe(100);
  });

  it('converts an SLA to monthly downtime', () => {
    expect(slaToDowntimeMinutes(99.9)).toBeCloseTo(43.2, 1);
    expect(slaToDowntimeMinutes(99.99)).toBeCloseTo(4.3, 1);
  });
});

describe('baseline coverage', () => {
  it('has a profile for every catalog service', () => {
    const missing = azureServiceCatalog
      .filter((s) => !s.draft)
      .map((s) => s.id)
      .filter((id) => resolveNodeSla(id, {}, 'eastus2').profile.source.confidence === 'estimated');
    expect(missing).toEqual(['ai-foundry']);
  });

  it('does not throw on an unknown service id', () => {
    const resolved = resolveNodeSla('not-a-real-service', {}, 'eastus2');
    expect(resolved.profile.slaPercent).toBeGreaterThan(0);
    expect(resolved.profile.source.confidence).toBe('estimated');
  });
});

describe('zone redundancy gates', () => {
  it('downgrades when the region has no availability zones', () => {
    const resolved = resolveNodeSla('postgresql', { zoneRedundant: true }, 'westus');
    expect(resolved.profile.tier).toBe('nonzonal');
    expect(resolved.requestedTier).toBe('zoneRedundant');
    expect(resolved.blocked?.gate).toBe('region');
  });

  it('reaches zone redundancy when region and flag agree', () => {
    const resolved = resolveNodeSla('postgresql', { zoneRedundant: true }, 'eastus2');
    expect(resolved.profile.tier).toBe('zoneRedundant');
    expect(resolved.blocked).toBeNull();
  });

  it('treats storage zone redundancy as a function of the sku', () => {
    const lrs = resolveNodeSla(
      'storage-account',
      { zoneRedundant: true, sku: 'Standard_LRS' },
      'eastus2',
    );
    expect(lrs.profile.tier).toBe('nonzonal');
    expect(lrs.blocked?.gate).toBe('service');

    const zrs = resolveNodeSla(
      'storage-account',
      { zoneRedundant: true, sku: 'Standard_ZRS' },
      'eastus2',
    );
    expect(zrs.profile.tier).toBe('zoneRedundant');
  });

  it('requires enough instances to span zones', () => {
    const single = resolveNodeSla(
      'app-service-plan',
      { zoneRedundant: true, capacity: 1 },
      'eastus2',
    );
    expect(single.profile.tier).toBe('nonzonal');
    expect(single.blocked?.message).toContain('at least 2');

    const pair = resolveNodeSla(
      'app-service-plan',
      { zoneRedundant: true, capacity: 2 },
      'eastus2',
    );
    expect(pair.profile.tier).toBe('zoneRedundant');
  });

  it('ignores region and zones for global services', () => {
    const resolved = resolveNodeSla('front-door', { zoneRedundant: true }, 'westus');
    expect(resolved.profile.tier).toBe('global');
    expect(resolved.blocked).toBeNull();
  });

  it('promotes to multi-region when the service supports it', () => {
    const resolved = resolveNodeSla('cosmos-db', { multiRegion: true }, 'eastus2');
    expect(resolved.profile.tier).toBe('multiRegion');
    expect(resolved.profile.slaPercent).toBe(99.999);
  });
});

describe('analyzeResiliency', () => {
  it('returns an empty report for an empty diagram', () => {
    const report = analyzeResiliency(emptyDiagram('empty'));
    expect(report.nodes).toEqual([]);
    expect(report.compositeSlaPercent).toBe(100);
    expect(report.weakestLink).toBeNull();
    expect(report.findings).toEqual([]);
  });

  it('excludes supporting services from the composite', () => {
    const report = analyzeResiliency(diagramWith(['app-service', 'app-insights', 'entra-id']));
    expect(report.excludedNodeIds).toHaveLength(2);
    expect(report.compositeSlaPercent).toBe(99.95);
  });

  it('honours an explicit per-node opt-out', () => {
    const report = analyzeResiliency(
      diagramWith([
        { serviceId: 'app-service' },
        { serviceId: 'redis', properties: { excludeFromSla: true } },
      ]),
    );
    expect(report.compositeSlaPercent).toBe(99.95);
  });

  it('identifies the weakest link and sorts worst first', () => {
    const report = analyzeResiliency(diagramWith(['key-vault', 'redis', 'app-service']));
    expect(report.weakestLink?.serviceId).toBe('redis');
    expect(report.nodes[0]?.serviceId).toBe('redis');
  });

  it('flags a composite below the target', () => {
    const diagram = diagramWith(['app-service', 'redis', 'sql-database']);
    diagram.metadata.resiliency = { slaPercent: 99.99, rtoMinutes: 240, rpoMinutes: 15 };
    const report = analyzeResiliency(diagram);
    expect(report.meetsTarget).toBe(false);
    expect(report.findings.map((f) => f.id)).toContain('res-target-sla');
  });

  it('reports the worst published recovery objectives', () => {
    const report = analyzeResiliency(diagramWith(['sql-database', 'app-service']));
    expect(report.worstRtoMinutes).toBe(30);
    expect(report.worstRpoMinutes).toBe(5);
  });

  it('warns when a zone-capable region has no zone-redundant resource', () => {
    const report = analyzeResiliency(diagramWith(['app-service', 'sql-database']));
    expect(report.findings.map((f) => f.id)).toContain('res-no-zone-redundancy');
  });

  it('flags a scalable service running too few instances to span zones', () => {
    const report = analyzeResiliency(
      diagramWith([{ serviceId: 'app-service-plan', properties: { capacity: 1 } }]),
    );
    const finding = report.findings.find((f) => f.id === 'res-single-instance');
    expect(finding?.nodeIds).toEqual(['n0']);
  });

  it('does not flag single-instance when the count meets the zone-redundant minimum', () => {
    const report = analyzeResiliency(
      diagramWith([{ serviceId: 'app-service-plan', properties: { capacity: 2 } }]),
    );
    expect(report.findings.map((f) => f.id)).not.toContain('res-single-instance');
  });

  it('flags a scale set with a single instance', () => {
    const report = analyzeResiliency(
      diagramWith([{ serviceId: 'vmss', properties: { instances: 1 } }]),
    );
    expect(report.findings.map((f) => f.id)).toContain('res-single-instance');
  });

  it('flags a single-zone data tier per node', () => {
    const report = analyzeResiliency(diagramWith(['app-service', 'sql-database']));
    const finding = report.findings.find((f) => f.id === 'res-single-zone-data');
    expect(finding?.nodeIds).toEqual(['n1']);
    expect(finding?.fix).toContain('Enable zone redundancy');
  });

  it('flags a single-zone data tier even in a region without zones', () => {
    const report = analyzeResiliency(diagramWith(['sql-database'], 'westus'));
    const finding = report.findings.find((f) => f.id === 'res-single-zone-data');
    expect(finding?.fix).toContain('region with availability zones');
  });

  it('does not flag a zone-redundant data tier', () => {
    const report = analyzeResiliency(
      diagramWith([
        {
          serviceId: 'sql-database',
          properties: { zoneRedundant: true, tier: 'BusinessCritical' },
        },
      ]),
    );
    expect(report.findings.map((f) => f.id)).not.toContain('res-single-zone-data');
  });

  it('surfaces a region gate failure as a high-severity finding', () => {
    const report = analyzeResiliency(
      diagramWith([{ serviceId: 'postgresql', properties: { zoneRedundant: true } }], 'westus'),
    );
    const finding = report.findings.find((f) => f.id === 'res-zone-region');
    expect(finding?.severity).toBe('high');
    expect(finding?.nodeIds).toEqual(['n0']);
  });

  it('applies grounded overrides in place of baseline figures', () => {
    const report = analyzeResiliency(diagramWith(['app-service']), {
      overrides: [
        {
          serviceId: 'app-service',
          tier: 'nonzonal',
          slaPercent: 99.9,
          rtoMinutes: null,
          rpoMinutes: null,
          basis: 'From Learn',
          source: { kind: 'learn', url: 'https://learn.microsoft.com/', confidence: 'derived' },
        },
      ],
    });
    expect(report.compositeSlaPercent).toBe(99.9);
    expect(report.nodes[0]?.profile.source.kind).toBe('learn');
  });
});

describe('describeNodeResiliency', () => {
  it('recommends zone redundancy for a single-zone service', () => {
    const explanation = describeNodeResiliency('postgresql', {}, 'eastus2');
    expect(explanation.tier).toBe('nonzonal');
    expect(explanation.atBestTier).toBe(false);
    expect(explanation.summary).toContain('single zone');
    const zr = explanation.recommendations.find((r) => r.tier === 'zoneRedundant');
    expect(zr).toBeDefined();
    expect(zr?.settings).toContainEqual({ property: 'zoneRedundant', value: 'true' });
    expect(zr?.slaPercent).toBe(99.99);
  });

  it('names the required sku for storage zone redundancy', () => {
    const explanation = describeNodeResiliency('storage-account', {}, 'eastus2');
    const zr = explanation.recommendations.find((r) => r.tier === 'zoneRedundant');
    expect(zr?.settings).toContainEqual({ property: 'sku', value: 'Standard_ZRS' });
    const mr = explanation.recommendations.find((r) => r.tier === 'multiRegion');
    expect(mr?.settings).toContainEqual({ property: 'multiRegion', value: 'true' });
  });

  it('drops zone-redundant settings and explains when the region has no zones', () => {
    const explanation = describeNodeResiliency('postgresql', {}, 'westus');
    const zr = explanation.recommendations.find((r) => r.tier === 'zoneRedundant');
    expect(zr).toBeDefined();
    expect(zr?.settings).toEqual([]);
    expect(zr?.description).toContain('no availability zones');
  });

  it('reports no recommendations for a global service', () => {
    const explanation = describeNodeResiliency('front-door', {}, 'eastus2');
    expect(explanation.tier).toBe('global');
    expect(explanation.atBestTier).toBe(true);
    expect(explanation.recommendations).toEqual([]);
  });

  it('marks a service already at its strongest tier as best', () => {
    const explanation = describeNodeResiliency('postgresql', { zoneRedundant: true }, 'eastus2');
    expect(explanation.tier).toBe('zoneRedundant');
    expect(explanation.atBestTier).toBe(true);
    expect(explanation.recommendations).toEqual([]);
  });

  it('marks a multi-region service at its strongest tier as best', () => {
    const explanation = describeNodeResiliency('cosmos-db', { multiRegion: true }, 'eastus2');
    expect(explanation.tier).toBe('multiRegion');
    expect(explanation.atBestTier).toBe(true);
    expect(explanation.recommendations).toEqual([]);
  });
});
