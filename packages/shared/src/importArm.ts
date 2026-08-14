import { azureServiceCatalog, getServiceDefinition } from './catalog.js';
import { layoutDiagram } from './layout.js';
import type { Diagram, DiagramEdge, DiagramGroup, DiagramNode } from './schema.js';

/**
 * Deterministic Azure -> diagram import (no model). Maps real Azure resource
 * types to catalog service ids using the catalog's own `iac.resourceType`, so a
 * deployed or declared topology renders faithfully. Shared by the ARM/Bicep
 * template importer and the live Azure Resource Graph importer.
 */

/** A normalized Azure resource from an ARM template or Resource Graph query. */
export interface ImportResource {
  /** Stable key (symbolic name for symbolic templates, else type#index). */
  key: string;
  /** ARM resource type, e.g. "Microsoft.App/containerApps". */
  type: string;
  /** Resource name (may be an ARM expression in templates). */
  name: string;
  /** ARM "kind" discriminator, used to disambiguate shared resource types. */
  kind?: string;
  /** Full ARM resource id, when known (Resource Graph). */
  id?: string;
  /** Raw dependsOn entries (symbolic names, resourceId() expressions, or ids). */
  dependsOn?: string[];
  /** Resource properties, scanned for references to other resources. */
  properties?: unknown;
  /** Existing resources are referenced by the deployment but not created by it. */
  existing?: boolean;
  /** Catalog override when an ARM type is shared by distinct Azure services. */
  serviceId?: string;
}

// Infrastructure glue that should not appear as its own node.
const SKIP_TYPES = new Set([
  'microsoft.authorization/roleassignments',
  'microsoft.authorization/locks',
  'microsoft.resources/deployments',
  'microsoft.insights/diagnosticsettings',
]);

/** resourceType (lowercase) -> catalog service ids that declare it. */
function buildTypeIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const service of azureServiceCatalog) {
    const type = service.iac?.resourceType?.toLowerCase();
    if (!type) continue;
    const ids = index.get(type) ?? [];
    ids.push(service.id);
    index.set(type, ids);
  }
  return index;
}

const typeIndex = buildTypeIndex();

/**
 * Resolve an Azure resource type to a catalog service id. Returns `null` to skip
 * (pure infra glue) and `'external'` for a real resource with no catalog mapping,
 * so nothing is silently dropped.
 */
export function resolveServiceId(type: string, kind?: string): string | null {
  const normalized = type.toLowerCase();
  if (SKIP_TYPES.has(normalized)) return null;

  const candidates = typeIndex.get(normalized);
  if (!candidates || candidates.length === 0) return 'external';
  if (candidates.length === 1) return candidates[0]!;

  // Ambiguous type (e.g. Microsoft.Web/sites -> functions | app-service).
  const k = (kind ?? '').toLowerCase();
  if (normalized === 'microsoft.web/sites') {
    if (k.includes('functionapp'))
      return candidates.includes('functions') ? 'functions' : candidates[0]!;
    return candidates.includes('app-service') ? 'app-service' : candidates[0]!;
  }
  // Deterministic fallback: first by sort so the result is stable.
  return [...candidates].sort()[0]!;
}

/** Extract the resource name from a raw dependsOn entry. */
function dependencyName(raw: string): string | undefined {
  const trimmed = raw.trim();
  // resourceId('Microsoft.X/y', 'name'[, ...]) -> last quoted argument.
  const resourceIdMatch = /resourceid\s*\((.*)\)/i.exec(trimmed);
  const inner = resourceIdMatch?.[1];
  if (inner) {
    const args = inner.match(/'([^']*)'/g);
    const last = args?.[args.length - 1];
    if (last) return last.replace(/'/g, '');
  }
  // Full ARM id -> last path segment.
  if (trimmed.includes('/')) return trimmed.split('/').filter(Boolean).pop();
  return trimmed;
}

/** Recursively collect string values from a properties object. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
}

/** Build a diagram from normalized Azure resources (deterministic). */
export function armResourcesToDiagram(
  resources: ImportResource[],
  options: { name?: string; region?: string; resourceGroupLabel?: string } = {},
): Diagram {
  const nodes: DiagramNode[] = [];
  const resourceGroupId = 'deployment-resource-group';
  const keyToNodeId = new Map<string, string>();
  const nameToNodeId = new Map<string, string>();
  const idToNodeId = new Map<string, string>();

  let counter = 0;
  for (const resource of resources) {
    const serviceId = resource.serviceId ?? resolveServiceId(resource.type, resource.kind);
    if (serviceId === null) continue;

    const nodeId = `n${counter++}`;
    const def = getServiceDefinition(serviceId);
    const label =
      serviceId === 'external'
        ? resource.name || resource.type.split('/').pop() || 'external'
        : resource.name || def?.name || serviceId;

    nodes.push({
      id: nodeId,
      serviceId,
      label,
      position: { x: 0, y: 0 },
      ...(options.resourceGroupLabel && !resource.existing ? { parentId: resourceGroupId } : {}),
      properties: {
        ...(resource.existing ? { existing: true } : {}),
      },
    });
    keyToNodeId.set(resource.key, nodeId);
    if (resource.name) nameToNodeId.set(resource.name, nodeId);
    if (resource.id) idToNodeId.set(resource.id.toLowerCase(), nodeId);
  }

  const edgeSet = new Set<string>();
  const edges: DiagramEdge[] = [];
  const addEdge = (sourceId: string, targetId: string): void => {
    if (sourceId === targetId) return;
    const dedupe = `${sourceId}->${targetId}`;
    if (edgeSet.has(dedupe)) return;
    edgeSet.add(dedupe);
    edges.push({ id: `e${edges.length}`, source: sourceId, target: targetId });
  };

  for (const resource of resources) {
    const sourceId = keyToNodeId.get(resource.key);
    if (!sourceId) continue;

    // Explicit dependsOn (ARM templates).
    for (const raw of resource.dependsOn ?? []) {
      const bySymbol = keyToNodeId.get(raw);
      if (bySymbol) {
        addEdge(sourceId, bySymbol);
        continue;
      }
      const name = dependencyName(raw);
      const target = name ? nameToNodeId.get(name) : undefined;
      if (target) addEdge(sourceId, target);
    }

    // Property references to other resources by full id (Resource Graph).
    const strings: string[] = [];
    collectStrings(resource.properties, strings);
    for (const value of strings) {
      const target = idToNodeId.get(value.toLowerCase());
      if (target) addEdge(sourceId, target);
    }
  }

  const groups: DiagramGroup[] =
    options.resourceGroupLabel && nodes.some((node) => node.parentId === resourceGroupId)
      ? [
          {
            id: resourceGroupId,
            kind: 'resourceGroup',
            label: options.resourceGroupLabel,
            position: { x: 0, y: 0 },
            size: { width: 320, height: 220 },
            collapsed: false,
            properties: {},
          },
        ]
      : [];

  const diagram: Diagram = {
    version: 1,
    metadata: {
      name: options.name ?? 'Imported architecture',
      description: 'Imported deterministically from Azure resources.',
      region: options.region ?? 'eastus2',
    },
    nodes,
    groups,
    edges,
  };

  return layoutDiagram(diagram);
}

interface ArmTemplateResource {
  type?: unknown;
  name?: unknown;
  kind?: unknown;
  dependsOn?: unknown;
  properties?: unknown;
}

/** Normalize an ARM template's resources (array or symbolic-name object form). */
function normalizeTemplateResources(template: unknown): ImportResource[] {
  const raw = (template as { resources?: unknown })?.resources;
  const entries: [string, ArmTemplateResource][] = [];

  if (Array.isArray(raw)) {
    raw.forEach((resource, index) => {
      const type = (resource as ArmTemplateResource)?.type;
      entries.push([
        `${typeof type === 'string' ? type : 'resource'}#${index}`,
        resource as ArmTemplateResource,
      ]);
    });
  } else if (raw && typeof raw === 'object') {
    for (const [symbol, resource] of Object.entries(raw as Record<string, ArmTemplateResource>)) {
      entries.push([symbol, resource]);
    }
  }

  const resources: ImportResource[] = [];
  for (const [key, resource] of entries) {
    if (typeof resource?.type !== 'string') continue;
    const dependsOn = Array.isArray(resource.dependsOn)
      ? resource.dependsOn.filter((d): d is string => typeof d === 'string')
      : undefined;
    resources.push({
      key,
      type: resource.type,
      name: typeof resource.name === 'string' ? resource.name : key,
      ...(typeof resource.kind === 'string' ? { kind: resource.kind } : {}),
      ...(dependsOn ? { dependsOn } : {}),
      ...(resource.properties !== undefined ? { properties: resource.properties } : {}),
    });
  }
  return resources;
}

/** Build a diagram from a compiled ARM template (JSON). */
export function armTemplateToDiagram(
  template: unknown,
  options: { name?: string; region?: string } = {},
): Diagram {
  return armResourcesToDiagram(normalizeTemplateResources(template), options);
}
