import dagre from '@dagrejs/dagre';
import type { Diagram, DiagramGroup, DiagramNode } from './schema.js';

const NODE_W = 180;
const NODE_H = 64;
const GROUP_PAD = 28;
const GROUP_HEADER = 28;

/**
 * Compute node/group positions with a hierarchical Dagre layout. Groups are laid
 * out as compound parents (nested when a group has a `parentId`), so members and
 * sub-groups stay together. Each group's box is sized to enclose its children
 * (nodes and sub-groups) with room for a header, and every node/group position
 * is expressed relative to its immediate parent so React Flow renders the
 * containment correctly.
 *
 * Deterministic for a given diagram, and independent of any incoming positions —
 * so it drives both AI generation (server) and a manual "Auto-layout" (client).
 */
export function layoutDiagram(diagram: Diagram): Diagram {
  if (diagram.nodes.length === 0) return diagram;

  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({ rankdir: 'LR', nodesep: 64, ranksep: 210, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const groupById = new Map(diagram.groups.map((gr) => [gr.id, gr]));
  const groupIds = new Set(groupById.keys());

  // Register groups (and their nesting) and nodes as compound members.
  for (const gr of diagram.groups) g.setNode(gr.id, { label: gr.label });
  for (const gr of diagram.groups) {
    if (gr.parentId && groupIds.has(gr.parentId)) g.setParent(gr.id, gr.parentId);
  }
  for (const n of diagram.nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
    if (n.parentId && groupIds.has(n.parentId)) g.setParent(n.id, n.parentId);
  }

  const nodeIds = new Set(diagram.nodes.map((n) => n.id));
  for (const e of diagram.edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    // Give labelled edges a reserved box so Dagre spaces connectors apart and
    // labels don't land on top of each other or on a node.
    if (e.label) {
      const width = Math.min(240, Math.max(48, e.label.length * 6.4));
      g.setEdge(e.source, e.target, { label: e.label, width, height: 22, labelpos: 'c' });
    } else {
      g.setEdge(e.source, e.target, {});
    }
  }

  dagre.layout(g);

  // Absolute top-left corners for nodes (Dagre reports centers).
  const absNode = new Map<string, { x: number; y: number }>();
  for (const n of diagram.nodes) {
    const gn = g.node(n.id);
    absNode.set(n.id, { x: gn.x - NODE_W / 2, y: gn.y - NODE_H / 2 });
  }

  // Depth in the group nesting tree (top-level = 0), used to size bottom-up.
  const depthOf = (id: string): number => {
    let depth = 0;
    let cur = groupById.get(id);
    while (cur?.parentId && groupById.has(cur.parentId)) {
      depth++;
      cur = groupById.get(cur.parentId);
    }
    return depth;
  };

  // Size group boxes deepest-first so a parent can enclose its sub-groups.
  const absGroup = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const gr of [...diagram.groups].sort((a, b) => depthOf(b.id) - depthOf(a.id))) {
    const boxes: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
    for (const n of diagram.nodes) {
      if (n.parentId !== gr.id) continue;
      const p = absNode.get(n.id)!;
      boxes.push({ minX: p.x, minY: p.y, maxX: p.x + NODE_W, maxY: p.y + NODE_H });
    }
    for (const c of diagram.groups) {
      if (c.parentId !== gr.id) continue;
      const b = absGroup.get(c.id);
      if (b) boxes.push({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height });
    }
    if (boxes.length === 0) continue;
    const minX = Math.min(...boxes.map((b) => b.minX));
    const minY = Math.min(...boxes.map((b) => b.minY));
    const maxX = Math.max(...boxes.map((b) => b.maxX));
    const maxY = Math.max(...boxes.map((b) => b.maxY));
    absGroup.set(gr.id, {
      x: minX - GROUP_PAD,
      y: minY - GROUP_PAD - GROUP_HEADER,
      width: maxX - minX + GROUP_PAD * 2,
      height: maxY - minY + GROUP_PAD * 2 + GROUP_HEADER,
    });
  }

  // Express every position relative to its immediate parent group.
  const groups: DiagramGroup[] = diagram.groups.map((gr) => {
    const box = absGroup.get(gr.id);
    if (!box) return { ...gr };
    const parent = gr.parentId ? absGroup.get(gr.parentId) : undefined;
    return {
      ...gr,
      position: parent ? { x: box.x - parent.x, y: box.y - parent.y } : { x: box.x, y: box.y },
      size: { width: box.width, height: box.height },
    };
  });
  const nodes: DiagramNode[] = diagram.nodes.map((n) => {
    const abs = absNode.get(n.id)!;
    const parent = n.parentId ? absGroup.get(n.parentId) : undefined;
    return { ...n, position: parent ? { x: abs.x - parent.x, y: abs.y - parent.y } : abs };
  });

  return {
    ...diagram,
    nodes,
    groups: groups.filter((gr) => absGroup.has(gr.id)),
  };
}
