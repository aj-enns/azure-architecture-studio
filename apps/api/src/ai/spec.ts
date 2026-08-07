import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  azureServiceCatalogById,
  emptyDiagram,
  groupKindSchema,
  type Diagram,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
} from '@aar/shared';

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
        },
        required: ['key', 'kind', 'label'],
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

// ---- Layout ---------------------------------------------------------------

const NODE_W = 180;
const NODE_H = 64;
const COL_GAP = 90;
const ROW_GAP = 40;
const GROUP_PAD = 32;
const GROUP_HEADER = 28;

/**
 * Deterministic layered grid layout. Nodes are laid out left-to-right in columns
 * derived from edge depth (a light topological ranking), so sources sit left of
 * their targets. Grouped nodes are packed into their group's box.
 */
function layoutColumns(keys: string[], edges: { from: string; to: string }[]): Map<string, number> {
  const depth = new Map<string, number>();
  for (const k of keys) depth.set(k, 0);

  // Relax depths a bounded number of passes (avoids cycles hanging).
  for (let pass = 0; pass < keys.length; pass++) {
    let changed = false;
    for (const e of edges) {
      if (!depth.has(e.from) || !depth.has(e.to)) continue;
      const next = (depth.get(e.from) ?? 0) + 1;
      if (next > (depth.get(e.to) ?? 0)) {
        depth.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

/**
 * Convert a validated AI spec into a `Diagram`. Unknown service ids are dropped;
 * edges referencing dropped nodes are dropped too. Ids and positions are assigned
 * here so the model never deals with them.
 */
export function specToDiagram(spec: AiDiagramSpec): Diagram {
  const diagram = emptyDiagram(spec.name);
  diagram.metadata.region = spec.region;

  // Map group keys → real group ids; positions filled after node placement.
  const groupIdByKey = new Map<string, string>();
  const groups: DiagramGroup[] = spec.groups.map((g) => {
    const id = `g_${nanoid(8)}`;
    groupIdByKey.set(g.key, id);
    return {
      id,
      kind: g.kind,
      label: g.label || g.kind,
      position: { x: 0, y: 0 },
      size: { width: 320, height: 220 },
      collapsed: false,
      properties: {},
    };
  });

  // Keep only nodes whose serviceId is a real catalog entry.
  const kept = spec.nodes.filter((n) => azureServiceCatalogById[n.serviceId]);
  const nodeIdByKey = new Map<string, string>();
  const keys = kept.map((n) => n.key);

  const edgesByKey = spec.edges.filter(
    (e) => keys.includes(e.from) && keys.includes(e.to),
  );
  const depth = layoutColumns(keys, edgesByKey);

  // Group nodes by column, then by group, to place them.
  const columnCursor = new Map<number, number>(); // column → next row index
  const nodes: DiagramNode[] = kept.map((n) => {
    const id = `n_${nanoid(8)}`;
    nodeIdByKey.set(n.key, id);
    const col = depth.get(n.key) ?? 0;
    const row = columnCursor.get(col) ?? 0;
    columnCursor.set(col, row + 1);
    const def = azureServiceCatalogById[n.serviceId];
    const parentId = n.group ? groupIdByKey.get(n.group) : undefined;
    return {
      id,
      serviceId: n.serviceId,
      label: n.label || def?.name || n.serviceId,
      position: {
        x: GROUP_PAD + col * (NODE_W + COL_GAP),
        y: GROUP_HEADER + GROUP_PAD + row * (NODE_H + ROW_GAP),
      },
      ...(parentId ? { parentId } : {}),
      properties: { ...(def?.defaults ?? {}) },
    };
  });

  // Size/position groups to encompass their child nodes.
  for (const group of groups) {
    const children = nodes.filter((n) => n.parentId === group.id);
    if (children.length === 0) continue;
    const minX = Math.min(...children.map((c) => c.position.x));
    const minY = Math.min(...children.map((c) => c.position.y));
    const maxX = Math.max(...children.map((c) => c.position.x + NODE_W));
    const maxY = Math.max(...children.map((c) => c.position.y + NODE_H));
    group.position = { x: minX - GROUP_PAD, y: minY - GROUP_PAD - GROUP_HEADER };
    group.size = {
      width: maxX - minX + GROUP_PAD * 2,
      height: maxY - minY + GROUP_PAD * 2 + GROUP_HEADER,
    };
    // Re-anchor children relative to the group so React Flow parent extent works.
    for (const c of children) {
      c.position = {
        x: c.position.x - group.position.x,
        y: c.position.y - group.position.y,
      };
    }
  }

  const edges: DiagramEdge[] = edgesByKey.map((e) => ({
    id: `e_${nanoid(8)}`,
    source: nodeIdByKey.get(e.from) as string,
    target: nodeIdByKey.get(e.to) as string,
    ...(e.label ? { label: e.label } : {}),
  }));

  diagram.nodes = nodes;
  diagram.groups = groups.filter((g) => nodes.some((n) => n.parentId === g.id));
  diagram.edges = edges;
  return diagram;
}
