import { describe, expect, it } from 'vitest';
import { emptyDiagram, type Diagram, type NodeProperties } from './schema.js';
import { analyzeThroughput } from './throughput.js';

function diagramWith(
  nodes: { serviceId: string; properties?: NodeProperties }[],
  target?: { usersPerMinute: number; requestsPerUser: number },
): Diagram {
  const d = emptyDiagram('test');
  d.nodes = nodes.map((n, i) => ({
    id: `n${i}`,
    serviceId: n.serviceId,
    label: n.serviceId,
    position: { x: 0, y: 0 },
    properties: n.properties ?? {},
  }));
  if (target) d.metadata.throughput = target;
  return d;
}

describe('throughput', () => {
  it('scales capability with the unit count', () => {
    const one = analyzeThroughput(
      diagramWith([{ serviceId: 'app-service-plan', properties: { capacity: 1 } }]),
    );
    const four = analyzeThroughput(
      diagramWith([{ serviceId: 'app-service-plan', properties: { capacity: 4 } }]),
    );
    expect(four.nodes[0].requestsPerMinute).toBe(one.nodes[0].requestsPerMinute * 4);
  });

  it('ignores non-gating services', () => {
    const report = analyzeThroughput(
      diagramWith([{ serviceId: 'key-vault' }, { serviceId: 'front-door' }]),
    );
    expect(report.nodes).toEqual([]);
    expect(report.bottleneck).toBeNull();
    expect(report.capacityPerMinute).toBeNull();
  });

  it('picks the weakest resource as the bottleneck', () => {
    const report = analyzeThroughput(
      diagramWith([
        { serviceId: 'app-service-plan', properties: { capacity: 4 } },
        { serviceId: 'application-gateway', properties: { capacity: 2 } },
      ]),
    );
    expect(report.bottleneck?.serviceId).toBe('application-gateway');
    expect(report.capacityPerMinute).toBe(report.bottleneck?.requestsPerMinute);
  });

  it('meets target when there is none', () => {
    const report = analyzeThroughput(diagramWith([{ serviceId: 'app-service-plan' }]));
    expect(report.targetPerMinute).toBeNull();
    expect(report.meetsTarget).toBe(true);
    expect(report.totalAddedMonthlyUsd).toBe(0);
  });

  it('flags under-provisioned resources and recommends scale + cost', () => {
    const report = analyzeThroughput(
      diagramWith([{ serviceId: 'application-gateway', properties: { capacity: 2 } }], {
        usersPerMinute: 10000,
        requestsPerUser: 3,
      }),
    );
    expect(report.targetPerMinute).toBe(30000);
    expect(report.meetsTarget).toBe(false);
    const gw = report.nodes[0];
    expect(gw.meetsTarget).toBe(false);
    expect(gw.recommendedUnits).toBeGreaterThan(gw.currentUnits);
    expect((gw.recommendedUnits * gw.requestsPerMinute) / gw.currentUnits).toBeGreaterThanOrEqual(
      30000,
    );
    expect(gw.addedMonthlyUsd).toBeGreaterThan(0);
    expect(report.totalAddedMonthlyUsd).toBe(gw.addedMonthlyUsd);
  });

  it('marks capReached when the service cannot scale to target', () => {
    const report = analyzeThroughput(
      diagramWith([{ serviceId: 'vm', properties: { instances: 1 } }], {
        usersPerMinute: 100000,
        requestsPerUser: 1,
      }),
    );
    const vm = report.nodes[0];
    expect(vm.capReached).toBe(true);
    expect(vm.recommendedUnits).toBe(1);
    expect(vm.addedMonthlyUsd).toBe(0);
  });

  it('passes when capacity already covers the target', () => {
    const report = analyzeThroughput(
      diagramWith([{ serviceId: 'app-service-plan', properties: { capacity: 4 } }], {
        usersPerMinute: 1000,
        requestsPerUser: 3,
      }),
    );
    expect(report.meetsTarget).toBe(true);
    expect(report.nodes[0].meetsTarget).toBe(true);
    expect(report.totalAddedMonthlyUsd).toBe(0);
  });

  it('handles an empty diagram', () => {
    const report = analyzeThroughput(emptyDiagram());
    expect(report.nodes).toEqual([]);
    expect(report.meetsTarget).toBe(true);
  });
});
