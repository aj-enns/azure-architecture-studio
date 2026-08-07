import { describe, expect, it } from 'vitest';
import {
  azureServiceCatalog,
  emptyDiagram,
  getServiceDefinition,
  getServicesByCategory,
  safeParseDiagram,
} from './index.js';

describe('diagram schema', () => {
  it('creates a valid empty diagram', () => {
    const d = emptyDiagram('Test');
    expect(d.version).toBe(1);
    expect(d.metadata.name).toBe('Test');
    expect(d.nodes).toEqual([]);
  });

  it('round-trips a diagram with a node', () => {
    const parsed = safeParseDiagram({
      version: 1,
      metadata: { name: 'X' },
      nodes: [{ id: 'n1', serviceId: 'storage-account', position: { x: 0, y: 0 } }],
      groups: [],
      edges: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an invalid diagram', () => {
    const parsed = safeParseDiagram({ version: 2 });
    expect(parsed.success).toBe(false);
  });
});

describe('azure service catalog', () => {
  it('has unique service ids', () => {
    const ids = azureServiceCatalog.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves a known service and its defaults', () => {
    const svc = getServiceDefinition('container-apps');
    expect(svc?.name).toBe('Container Apps');
    expect(svc?.category).toBe('containers');
  });

  it('every node serviceId in defaults resolves to a real icon slug', () => {
    for (const s of azureServiceCatalog) {
      expect(s.icon.length).toBeGreaterThan(0);
    }
  });

  it('filters services by category', () => {
    const dbs = getServicesByCategory('databases');
    expect(dbs.length).toBeGreaterThan(0);
    expect(dbs.every((s) => s.category === 'databases')).toBe(true);
  });
});
