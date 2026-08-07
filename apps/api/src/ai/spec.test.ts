import { describe, expect, it } from 'vitest';
import { safeParseDiagram } from '@aar/shared';
import { aiDiagramSpecSchema, specToDiagram } from './spec.js';

describe('specToDiagram', () => {
  it('maps a valid spec to a schema-valid diagram with real ids', () => {
    const spec = aiDiagramSpecSchema.parse({
      name: 'Web + DB',
      region: 'eastus2',
      groups: [{ key: 'rg', kind: 'resourceGroup', label: 'app-rg' }],
      nodes: [
        { key: 'web', serviceId: 'app-service', label: 'frontend', group: 'rg' },
        { key: 'db', serviceId: 'sql-database', label: 'orders', group: 'rg' },
      ],
      edges: [{ from: 'web', to: 'db', label: 'reads' }],
    });

    const diagram = specToDiagram(spec);
    expect(safeParseDiagram(diagram).success).toBe(true);
    expect(diagram.nodes).toHaveLength(2);
    expect(diagram.edges).toHaveLength(1);
    expect(diagram.groups).toHaveLength(1);
    expect(diagram.nodes.every((n) => n.id.startsWith('n_'))).toBe(true);
    expect(diagram.edges[0]?.id.startsWith('e_')).toBe(true);
    // Nodes are re-parented onto the group.
    expect(diagram.nodes.every((n) => n.parentId === diagram.groups[0]?.id)).toBe(true);
  });

  it('drops nodes with unknown service ids and their edges', () => {
    const spec = aiDiagramSpecSchema.parse({
      name: 'Partial',
      region: 'eastus2',
      groups: [],
      nodes: [
        { key: 'ok', serviceId: 'storage-account', label: 'data' },
        { key: 'bad', serviceId: 'not-a-real-service', label: 'ghost' },
      ],
      edges: [{ from: 'ok', to: 'bad' }],
    });

    const diagram = specToDiagram(spec);
    expect(diagram.nodes).toHaveLength(1);
    expect(diagram.nodes[0]?.serviceId).toBe('storage-account');
    expect(diagram.edges).toHaveLength(0);
    expect(safeParseDiagram(diagram).success).toBe(true);
  });
});
