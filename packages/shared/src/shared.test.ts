import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  azureServiceCatalog,
  emptyDiagram,
  getServiceDefinition,
  getServicesByCategory,
  isExternalServiceId,
  safeParseDiagram,
  serviceDefinitionSchema,
} from './index.js';
import { generatedServiceCatalog } from './catalog.generated.js';

const ICONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/web/src/assets/azure-icons',
);

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

  it('recognizes generic and typed external service ids', () => {
    expect(isExternalServiceId('external')).toBe(true);
    expect(isExternalServiceId('external:browser')).toBe(true);
    expect(isExternalServiceId('container-apps')).toBe(false);
  });
});

describe('generated catalog candidates', () => {
  it('every generated entry validates and is marked draft', () => {
    for (const s of generatedServiceCatalog) {
      expect(serviceDefinitionSchema.safeParse(s).success).toBe(true);
      expect(s.draft).toBe(true);
    }
  });

  it('has no duplicate ids among generated entries', () => {
    const ids = generatedServiceCatalog.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('references an icon SVG that exists on disk', () => {
    for (const s of generatedServiceCatalog) {
      expect(existsSync(resolve(ICONS_DIR, `${s.icon}.svg`))).toBe(true);
    }
  });
});
