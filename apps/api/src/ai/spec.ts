import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  azureServiceCatalogById,
  emptyDiagram,
  groupKindSchema,
  isExternalServiceId,
  layoutDiagram,
  type Diagram,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
} from '@aas/shared';

/**
 * The **AI spec** — the compact, position-free shape the model returns
 * (ADR-0010). Keys are model-chosen strings used only to wire edges/grouping;
 * the server maps them to real ids and computes layout.
 */
export const aiNodeSpecSchema = z.object({
  key: z.string().min(1),
  serviceId: z.string().min(1),
  label: z.string().default(''),
  group: z.string().optional(),
});

export const aiGroupSpecSchema = z.object({
  key: z.string().min(1),
  kind: groupKindSchema.default('custom'),
  label: z.string().default(''),
  parent: z.string().optional(),
});

export const aiEdgeSpecSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});

export const aiDiagramSpecSchema = z.object({
  name: z.string().default('Untitled Architecture'),
  region: z.string().default('eastus2'),
  groups: z.array(aiGroupSpecSchema).default([]),
  nodes: z.array(aiNodeSpecSchema).default([]),
  edges: z.array(aiEdgeSpecSchema).default([]),
});

export type AiDiagramSpec = z.infer<typeof aiDiagramSpecSchema>;

/**
 * JSON Schema handed to Azure OpenAI `response_format: json_schema`. Kept in
 * sync with `aiDiagramSpecSchema` by hand (small and stable). `strict` mode
 * requires every property listed in `required` and `additionalProperties:false`.
 */
export const aiDiagramJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', description: 'Short title for the architecture.' },
    region: { type: 'string', description: 'Azure region, e.g. eastus2.' },
    groups: {
      type: 'array',
      description: 'Optional containers: subscriptions, resource groups, VNets, subnets.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', description: 'Unique key referenced by node.group.' },
          kind: {
            type: 'string',
            enum: ['subscription', 'resourceGroup', 'vnet', 'subnet', 'custom'],
          },
          label: { type: 'string' },
          parent: {
            type: 'string',
            description: 'Key of the group this group nests inside, or "" for top-level.',
          },
        },
        required: ['key', 'kind', 'label', 'parent'],
      },
    },
    nodes: {
      type: 'array',
      description: 'Azure resources placed on the canvas.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          key: { type: 'string', description: 'Unique key referenced by edges.' },
          serviceId: { type: 'string', description: 'MUST be a catalog service id.' },
          label: { type: 'string', description: 'Instance name shown on the node.' },
          group: { type: 'string', description: 'Optional group key this node sits inside.' },
        },
        required: ['key', 'serviceId', 'label', 'group'],
      },
    },
    edges: {
      type: 'array',
      description: 'Connections between nodes (by node key).',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['from', 'to', 'label'],
      },
    },
  },
  required: ['name', 'region', 'groups', 'nodes', 'edges'],
} as const;

// ---- Spec → Diagram -------------------------------------------------------

/**
 * Convert a validated AI spec into a `Diagram`. Unknown service ids are dropped;
 * edges referencing dropped nodes are dropped too. Ids are assigned here; the
 * shared Dagre layout computes positions and group boxes.
 */
export function specToDiagram(spec: AiDiagramSpec): Diagram {
  const diagram = emptyDiagram(spec.name);
  diagram.metadata.region = spec.region;

  // Assign group ids first so a group's `parent` key can resolve regardless of order.
  const groupIdByKey = new Map<string, string>();
  for (const g of spec.groups) groupIdByKey.set(g.key, `g_${nanoid(8)}`);
  const groups: DiagramGroup[] = spec.groups.map((g) => {
    const parentId = g.parent ? groupIdByKey.get(g.parent) : undefined;
    return {
      id: groupIdByKey.get(g.key) as string,
      kind: g.kind,
      label: g.label || g.kind,
      position: { x: 0, y: 0 },
      size: { width: 320, height: 220 },
      ...(parentId ? { parentId } : {}),
      collapsed: false,
      properties: {},
    };
  });

  // Keep nodes with a real catalog serviceId, plus explicit "external" markers.
  const kept = spec.nodes.filter(
    (n) => azureServiceCatalogById[n.serviceId] || isExternalServiceId(n.serviceId),
  );
  const nodeIdByKey = new Map<string, string>();

  const nodes: DiagramNode[] = kept.map((n) => {
    const id = `n_${nanoid(8)}`;
    nodeIdByKey.set(n.key, id);
    const def = azureServiceCatalogById[n.serviceId];
    const parentId = n.group ? groupIdByKey.get(n.group) : undefined;
    return {
      id,
      serviceId: n.serviceId,
      label: n.label || def?.name || n.serviceId,
      position: { x: 0, y: 0 },
      ...(parentId ? { parentId } : {}),
      properties: { ...(def?.defaults ?? {}) },
    };
  });

  const keptKeys = new Set(kept.map((n) => n.key));
  const edges: DiagramEdge[] = spec.edges
    .filter((e) => keptKeys.has(e.from) && keptKeys.has(e.to))
    .map((e) => ({
      id: `e_${nanoid(8)}`,
      source: nodeIdByKey.get(e.from) as string,
      target: nodeIdByKey.get(e.to) as string,
      ...(e.label ? { label: e.label } : {}),
    }));

  // Keep groups that contain a node, plus their ancestors (so nesting survives).
  const keepGroups = new Set<string>();
  for (const n of nodes) {
    let gid = n.parentId;
    while (gid) {
      keepGroups.add(gid);
      gid = groups.find((x) => x.id === gid)?.parentId;
    }
  }

  diagram.nodes = nodes;
  diagram.groups = groups.filter((g) => keepGroups.has(g.id));
  diagram.edges = edges;

  // Positions and group boxes are computed by the shared Dagre layout.
  return layoutDiagram(diagram);
}
