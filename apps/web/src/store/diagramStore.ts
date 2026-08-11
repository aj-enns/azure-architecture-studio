import { nanoid } from 'nanoid';
import { create } from 'zustand';
import {
  emptyDiagram,
  getServiceDefinition,
  layoutDiagram,
  safeParseDiagram,
  type Diagram,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
  type GroupKind,
  type NodeProperties,
  type ResiliencyTarget,
} from '@aar/shared';

const STORAGE_KEY = 'aar.diagram';

export type Selection =
  | { type: 'node'; id: string }
  | { type: 'group'; id: string }
  | { type: 'edge'; id: string }
  | null;

interface DiagramState {
  diagram: Diagram;
  selection: Selection;
  /** Bumped on external/structural changes (load, add, remove, relayout) but NOT
   *  on position/size echoes from the canvas, so the renderer can rebuild node
   *  state without thrashing React Flow's measurement. */
  revision: number;

  // selection
  select: (selection: Selection) => void;

  // nodes
  addNode: (serviceId: string, position: { x: number; y: number }) => string;
  updateNodePosition: (id: string, position: { x: number; y: number }) => void;
  updateNodeLabel: (id: string, label: string) => void;
  updateNodeProperty: (id: string, key: string, value: string | number | boolean) => void;
  removeNode: (id: string) => void;

  // groups
  addGroup: (kind: GroupKind, position: { x: number; y: number }) => string;
  updateGroup: (id: string, patch: Partial<Pick<DiagramGroup, 'label' | 'position' | 'size'>>) => void;
  removeGroup: (id: string) => void;

  // edges
  addEdge: (source: string, target: string) => void;
  removeEdge: (id: string) => void;

  // metadata
  setName: (name: string) => void;
  setRegion: (region: string) => void;
  setResiliencyTarget: (target: ResiliencyTarget | undefined) => void;

  // document
  reset: () => void;
  load: (diagram: Diagram) => void;
  relayout: () => void;
  importJson: (json: string) => { ok: true } | { ok: false; error: string };
  exportJson: () => string;
}

function persist(diagram: Diagram): void {
  try {
    const withTimestamp: Diagram = {
      ...diagram,
      metadata: { ...diagram.metadata, updatedAt: new Date().toISOString() },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withTimestamp));
  } catch {
    // localStorage may be unavailable (private mode/quota) — non-fatal.
  }
}

function loadPersisted(): Diagram {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDiagram();
    const parsed = safeParseDiagram(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyDiagram();
  } catch {
    return emptyDiagram();
  }
}

/** Apply a mutation to the diagram, persist, and return the next state. */
function mutate(current: Diagram, fn: (draft: Diagram) => void): Diagram {
  const next: Diagram = structuredClone(current);
  fn(next);
  persist(next);
  return next;
}

export const useDiagramStore = create<DiagramState>((set, get) => ({
  diagram: loadPersisted(),
  selection: null,
  revision: 0,

  select: (selection) => set({ selection }),

  addNode: (serviceId, position) => {
    const def = getServiceDefinition(serviceId);
    const id = `n_${nanoid(8)}`;
    const node: DiagramNode = {
      id,
      serviceId,
      label: def?.name ?? serviceId,
      position,
      properties: { ...(def?.defaults ?? {}) } as NodeProperties,
    };
    set((s) => ({ diagram: mutate(s.diagram, (d) => void d.nodes.push(node)), selection: { type: 'node', id }, revision: s.revision + 1 }));
    return id;
  },

  updateNodePosition: (id, position) =>
    set((s) => ({
      diagram: mutate(s.diagram, (d) => {
        const n = d.nodes.find((x) => x.id === id);
        if (n) n.position = position;
      }),
    })),

  updateNodeLabel: (id, label) =>
    set((s) => ({
      diagram: mutate(s.diagram, (d) => {
        const n = d.nodes.find((x) => x.id === id);
        if (n) n.label = label;
      }),
      revision: s.revision + 1,
    })),

  updateNodeProperty: (id, key, value) =>
    set((s) => ({
      diagram: mutate(s.diagram, (d) => {
        const n = d.nodes.find((x) => x.id === id);
        if (n) n.properties = { ...n.properties, [key]: value };
      }),
      revision: s.revision + 1,
    })),

  removeNode: (id) =>
    set((s) => ({
      diagram: mutate(s.diagram, (d) => {
        d.nodes = d.nodes.filter((x) => x.id !== id);
        d.edges = d.edges.filter((e) => e.source !== id && e.target !== id);
      }),
      selection: null,
      revision: s.revision + 1,
    })),

  addGroup: (kind, position) => {
    const id = `g_${nanoid(8)}`;
    const labels: Record<GroupKind, string> = {
      subscription: 'Subscription',
      resourceGroup: 'Resource Group',
      vnet: 'Virtual Network',
      subnet: 'Subnet',
      custom: 'Group',
    };
    const group: DiagramGroup = {
      id,
      kind,
      label: labels[kind],
      position,
      size: { width: 320, height: 220 },
      collapsed: false,
      properties: {},
    };
    set((s) => ({ diagram: mutate(s.diagram, (d) => void d.groups.push(group)), selection: { type: 'group', id }, revision: s.revision + 1 }));
    return id;
  },

  updateGroup: (id, patch) =>
    set((s) => ({
      diagram: mutate(s.diagram, (d) => {
        const g = d.groups.find((x) => x.id === id);
        if (g) Object.assign(g, patch);
      }),
    })),

  removeGroup: (id) =>
    set((s) => ({
      diagram: mutate(s.diagram, (d) => {
        d.groups = d.groups.filter((x) => x.id !== id);
        for (const n of d.nodes) if (n.parentId === id) n.parentId = undefined;
      }),
      selection: null,
      revision: s.revision + 1,
    })),

  addEdge: (source, target) =>
    set((s) => ({
      diagram: mutate(s.diagram, (d) => {
        if (source === target) return;
        const exists = d.edges.some((e) => e.source === source && e.target === target);
        if (exists) return;
        const edge: DiagramEdge = { id: `e_${nanoid(8)}`, source, target };
        d.edges.push(edge);
      }),
    })),

  removeEdge: (id) =>
    set((s) => ({
      diagram: mutate(s.diagram, (d) => {
        d.edges = d.edges.filter((e) => e.id !== id);
      }),
      selection: null,
    })),

  setName: (name) =>
    set((s) => ({
      diagram: mutate(s.diagram, (d) => {
        d.metadata.name = name;
      }),
    })),

  setResiliencyTarget: (target) =>
    set((s) => ({
      diagram: mutate(s.diagram, (d) => {
        d.metadata.resiliency = target;
      }),
      revision: s.revision + 1,
    })),

  setRegion: (region) =>
    set((s) => ({
      diagram: mutate(s.diagram, (d) => {
        d.metadata.region = region;
      }),
      revision: s.revision + 1,
    })),

  reset: () => {
    const fresh = emptyDiagram();
    persist(fresh);
    set((s) => ({ diagram: fresh, selection: null, revision: s.revision + 1 }));
  },

  load: (diagram) => {
    persist(diagram);
    set((s) => ({ diagram, selection: null, revision: s.revision + 1 }));
  },

  relayout: () => {
    set((s) => {
      const next = layoutDiagram(s.diagram);
      persist(next);
      return { diagram: next, selection: null, revision: s.revision + 1 };
    });
  },

  importJson: (json) => {
    try {
      const parsed = safeParseDiagram(JSON.parse(json));
      if (!parsed.success) {
        return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid diagram' };
      }
      get().load(parsed.data);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' };
    }
  },

  exportJson: () => JSON.stringify(get().diagram, null, 2),
}));
