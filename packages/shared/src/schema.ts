import { z } from 'zod';

/**
 * Diagram model — the single source of truth shared by the web app and API.
 * Kept intentionally UI-library-agnostic (no React Flow types leak in here) so
 * the same model can drive rendering, AI generation, IaC export, and validation.
 */

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Position = z.infer<typeof positionSchema>;

export const sizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});
export type Size = z.infer<typeof sizeSchema>;

/** Free-form, string-keyed properties for a node (SKU, tier, region, etc.). */
export const nodePropertiesSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export type NodeProperties = z.infer<typeof nodePropertiesSchema>;

/**
 * A single Azure resource on the canvas.
 * `serviceId` references an entry in the Azure service catalog.
 */
export const diagramNodeSchema = z.object({
  id: z.string().min(1),
  serviceId: z.string().min(1),
  label: z.string().default(''),
  position: positionSchema,
  size: sizeSchema.optional(),
  /** id of a group node this node belongs to (for RG/VNet/subnet containers). */
  parentId: z.string().optional(),
  properties: nodePropertiesSchema.default({}),
});
export type DiagramNode = z.infer<typeof diagramNodeSchema>;

/** Container node type — used to draw subscriptions, resource groups, VNets, subnets. */
export const groupKindSchema = z.enum(['subscription', 'resourceGroup', 'vnet', 'subnet', 'custom']);
export type GroupKind = z.infer<typeof groupKindSchema>;

export const diagramGroupSchema = z.object({
  id: z.string().min(1),
  kind: groupKindSchema.default('custom'),
  label: z.string().default(''),
  position: positionSchema,
  size: sizeSchema,
  parentId: z.string().optional(),
  collapsed: z.boolean().default(false),
  properties: nodePropertiesSchema.default({}),
});
export type DiagramGroup = z.infer<typeof diagramGroupSchema>;

export const diagramEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
  /** Optional semantic hint, e.g. "private-endpoint", "vnet-integration", "data". */
  kind: z.string().optional(),
});
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

/** Availability and recovery objectives the design is measured against. */
export const resiliencyTargetSchema = z.object({
  slaPercent: z.number().min(0).max(100),
  rtoMinutes: z.number().nonnegative(),
  rpoMinutes: z.number().nonnegative(),
});
export type ResiliencyTarget = z.infer<typeof resiliencyTargetSchema>;

export const diagramMetadataSchema = z.object({
  name: z.string().default('Untitled Architecture'),
  description: z.string().default(''),
  /** Default Azure region used for pricing + deployment (e.g. "eastus2"). */
  region: z.string().default('eastus2'),
  resiliency: resiliencyTargetSchema.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type DiagramMetadata = z.infer<typeof diagramMetadataSchema>;

/** The complete, serializable diagram document (what import/export round-trips). */
export const diagramSchema = z.object({
  /** Schema version for forward-compatible migrations. */
  version: z.literal(1).default(1),
  metadata: diagramMetadataSchema.default({}),
  nodes: z.array(diagramNodeSchema).default([]),
  groups: z.array(diagramGroupSchema).default([]),
  edges: z.array(diagramEdgeSchema).default([]),
});
export type Diagram = z.infer<typeof diagramSchema>;

/** Parse unknown input (e.g. imported JSON or AI output) into a valid Diagram. */
export function parseDiagram(input: unknown): Diagram {
  return diagramSchema.parse(input);
}

/** Non-throwing variant for boundary validation. */
export function safeParseDiagram(input: unknown) {
  return diagramSchema.safeParse(input);
}

/** Create an empty diagram with sensible defaults. */
export function emptyDiagram(name = 'Untitled Architecture'): Diagram {
  return diagramSchema.parse({
    version: 1,
    metadata: { name },
    nodes: [],
    groups: [],
    edges: [],
  });
}
