import { describe, expect, it } from 'vitest';
import { emptyDiagram, type Diagram } from './schema.js';
import { estimateDiagramCost, estimateNodeCost } from './pricing.js';

function diagramWith(serviceIds: string[], region = 'eastus2'): Diagram {
  const d = emptyDiagram('test');
  d.metadata.region = region;
  d.nodes = serviceIds.map((serviceId, i) => ({
    id: `n${i}`,
    serviceId,
    label: serviceId,
    position: { x: 0, y: 0 },
    properties: {},
  }));
  return d;
}

describe('pricing', () => {
  it('estimates a known service', () => {
    const est = estimateNodeCost('app-service-plan');
    expect(est.monthlyUsd).toBeGreaterThan(0);
    expect(est.usageBased).toBe(false);
  });

  it('flags usage-based services', () => {
    expect(estimateNodeCost('functions').usageBased).toBe(true);
  });

  it('returns zero for free services', () => {
    expect(estimateNodeCost('managed-identity').monthlyUsd).toBe(0);
  });

  it('applies a regional multiplier', () => {
    const base = estimateNodeCost('app-service-plan', 'eastus2').monthlyUsd;
    const au = estimateNodeCost('app-service-plan', 'australiaeast').monthlyUsd;
    expect(au).toBeGreaterThan(base);
  });

  it('sums a diagram and breaks down by category', () => {
    const cost = estimateDiagramCost(diagramWith(['app-service-plan', 'sql-database', 'key-vault']));
    expect(cost.totalMonthlyUsd).toBe(
      estimateNodeCost('app-service-plan').monthlyUsd +
        estimateNodeCost('sql-database').monthlyUsd +
        estimateNodeCost('key-vault').monthlyUsd,
    );
    expect(cost.byCategory.length).toBeGreaterThan(0);
    expect(cost.hasUsageBased).toBe(true);
  });

  it('handles an empty diagram', () => {
    const cost = estimateDiagramCost(emptyDiagram());
    expect(cost.totalMonthlyUsd).toBe(0);
    expect(cost.nodes).toEqual([]);
  });
});
