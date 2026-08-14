import { describe, expect, it } from 'vitest';
import { emptyDiagram, type Diagram } from './schema.js';
import { layoutDiagram } from './layout.js';

function build(): Diagram {
  const d = emptyDiagram('test');
  d.groups = [
    {
      id: 'g1',
      kind: 'resourceGroup',
      label: 'rg',
      position: { x: 0, y: 0 },
      size: { width: 320, height: 220 },
      collapsed: false,
      properties: {},
    },
  ];
  d.nodes = [
    {
      id: 'a',
      serviceId: 'app-service',
      label: 'web',
      position: { x: 0, y: 0 },
      parentId: 'g1',
      properties: {},
    },
    {
      id: 'b',
      serviceId: 'sql-database',
      label: 'db',
      position: { x: 0, y: 0 },
      parentId: 'g1',
      properties: {},
    },
    { id: 'c', serviceId: 'front-door', label: 'fd', position: { x: 0, y: 0 }, properties: {} },
  ];
  d.edges = [
    { id: 'e1', source: 'c', target: 'a' },
    { id: 'e2', source: 'a', target: 'b' },
  ];
  return d;
}

describe('layoutDiagram', () => {
  it('returns an empty diagram unchanged', () => {
    const empty = emptyDiagram();
    expect(layoutDiagram(empty).nodes).toEqual([]);
  });

  it('places a source left of its target (rankdir LR)', () => {
    const out = layoutDiagram(build());
    const fd = out.nodes.find((n) => n.id === 'c')!;
    const web = out.nodes.find((n) => n.id === 'a')!;
    // front-door (c) feeds app-service (a): its absolute x should be smaller.
    expect(fd.position.x).toBeLessThan(web.position.x);
  });

  it('sizes the group to enclose its children with header room', () => {
    const out = layoutDiagram(build());
    const g = out.groups.find((x) => x.id === 'g1')!;
    expect(g.size.width).toBeGreaterThan(180);
    expect(g.size.height).toBeGreaterThan(64);
  });

  it('anchors grouped child positions relative to the group', () => {
    const out = layoutDiagram(build());
    const child = out.nodes.find((n) => n.id === 'a')!;
    // Local coordinates are small positive offsets inside the group box.
    expect(child.position.x).toBeGreaterThanOrEqual(0);
    expect(child.position.y).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic', () => {
    const a = layoutDiagram(build());
    const b = layoutDiagram(build());
    expect(a.nodes.map((n) => n.position)).toEqual(b.nodes.map((n) => n.position));
  });

  it('nests a child group inside its parent group', () => {
    const d = emptyDiagram('nested');
    d.groups = [
      {
        id: 'vnet',
        kind: 'vnet',
        label: 'vnet',
        position: { x: 0, y: 0 },
        size: { width: 320, height: 220 },
        collapsed: false,
        properties: {},
      },
      {
        id: 'subnet',
        kind: 'subnet',
        label: 'subnet',
        position: { x: 0, y: 0 },
        size: { width: 320, height: 220 },
        parentId: 'vnet',
        collapsed: false,
        properties: {},
      },
    ];
    d.nodes = [
      {
        id: 'a',
        serviceId: 'app-service',
        label: 'web',
        position: { x: 0, y: 0 },
        parentId: 'subnet',
        properties: {},
      },
    ];
    const out = layoutDiagram(d);
    const vnet = out.groups.find((x) => x.id === 'vnet')!;
    const subnet = out.groups.find((x) => x.id === 'subnet')!;
    // The subnet fits within the vnet's box (its local origin is non-negative and
    // its extent does not exceed the parent's size).
    expect(subnet.position.x).toBeGreaterThanOrEqual(0);
    expect(subnet.position.y).toBeGreaterThanOrEqual(0);
    expect(subnet.position.x + subnet.size.width).toBeLessThanOrEqual(vnet.size.width + 0.5);
    expect(subnet.position.y + subnet.size.height).toBeLessThanOrEqual(vnet.size.height + 0.5);
  });
});
