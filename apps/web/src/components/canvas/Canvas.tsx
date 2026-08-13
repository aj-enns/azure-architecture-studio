import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  addEdge as rfAddEdge,
  applyNodeChanges,
  MarkerType,
  useKeyPress,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeResiliency, getServiceDefinition } from '@aar/shared';
import { AzureNode } from './AzureNode.js';
import { AzureEdge } from './AzureEdge.js';
import { GroupNode } from './GroupNode.js';
import { categoryHex } from '@/lib/icons.js';
import { useTheme } from '@/lib/theme.js';
import { useDiagramStore } from '@/store/diagramStore.js';
import { useUiStore } from '@/store/uiStore.js';

const nodeTypes = { azureNode: AzureNode, azureGroup: GroupNode };
const edgeTypes = { azureEdge: AzureEdge };

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;

function toFlowNodes(
  groups: ReturnType<typeof useDiagramStore.getState>['diagram']['groups'],
  nodes: ReturnType<typeof useDiagramStore.getState>['diagram']['nodes'],
  resiliencyByNodeId: Map<string, { slaPercent: number; tier: string; isWeakest: boolean }>,
): Node[] {
  // Groups first so they render behind service nodes. Explicit width/height are
  // set on the node object (not only via style) so React Flow knows the parent
  // size synchronously — child nodes with `extent: 'parent'` otherwise fail to
  // mount when a diagram is swapped in asynchronously (e.g. AI generation).
  // Nested groups must appear parent-before-child, so sort by nesting depth.
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const depthOf = (g: (typeof groups)[number]): number => {
    let depth = 0;
    let cur: (typeof groups)[number] | undefined = g;
    while (cur?.parentId && groupById.has(cur.parentId)) {
      depth++;
      cur = groupById.get(cur.parentId);
    }
    return depth;
  };
  const sortedGroups = [...groups].sort((a, b) => depthOf(a) - depthOf(b));
  const groupNodes: Node[] = sortedGroups.map((g) => ({
    id: g.id,
    type: 'azureGroup',
    position: g.position,
    data: { kind: g.kind, label: g.label },
    width: g.size.width,
    height: g.size.height,
    style: { width: g.size.width, height: g.size.height },
    ...(g.parentId ? { parentId: g.parentId } : {}),
    selectable: true,
    zIndex: depthOf(g),
  }));

  const serviceNodes: Node[] = nodes.map((n) => ({
    id: n.id,
    type: 'azureNode',
    position: n.position,
    data: { serviceId: n.serviceId, label: n.label, resiliency: resiliencyByNodeId.get(n.id) },
    ...(n.parentId ? { parentId: n.parentId, extent: 'parent' as const } : {}),
    zIndex: 1000,
  }));

  return [...groupNodes, ...serviceNodes];
}

function CanvasInner(): JSX.Element {
  const { theme } = useTheme();
  const diagram = useDiagramStore((s) => s.diagram);
  const selection = useDiagramStore((s) => s.selection);
  const select = useDiagramStore((s) => s.select);
  const addNode = useDiagramStore((s) => s.addNode);
  const addEdge = useDiagramStore((s) => s.addEdge);
  const updateNodePosition = useDiagramStore((s) => s.updateNodePosition);
  const updateGroup = useDiagramStore((s) => s.updateGroup);
  const removeNode = useDiagramStore((s) => s.removeNode);
  const removeGroup = useDiagramStore((s) => s.removeGroup);
  const removeEdge = useDiagramStore((s) => s.removeEdge);
  const showGrid = useUiStore((s) => s.showGrid);

  // Computed once here rather than per node: the composite and weakest link
  // need the whole graph, so recomputing inside each node would be quadratic.
  const resiliencyByNodeId = useMemo(() => {
    const report = analyzeResiliency(diagram);
    return new Map(
      report.nodes.map((n) => [
        n.nodeId,
        {
          slaPercent: n.profile.slaPercent,
          tier: n.profile.tier,
          isWeakest: n.nodeId === report.weakestLink?.nodeId,
        },
      ]),
    );
  }, [diagram]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const modifierPanRef = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    viewport: Viewport;
  } | null>(null);
  const { screenToFlowPosition, fitView, getViewport, setViewport, setCenter, getInternalNode } =
    useReactFlow();
  const controlPressed = useKeyPress('Control');
  const [modifierPanning, setModifierPanning] = useState(false);

  useEffect(() => {
    if (!controlPressed) setModifierPanning(false);
  }, [controlPressed]);

  // React Flow owns the live node objects locally so that measured dimensions
  // (set by its ResizeObserver) survive re-renders. If we handed React Flow a
  // freshly derived array from the store on every render, it would lose each
  // node's `measured` flag — and because the DOM size never changes, the
  // observer would not re-fire, leaving child nodes stuck at `visibility:
  // hidden`. Groups avoid this only because they carry explicit width/height.
  const [rfNodes, setRfNodes] = useState<Node[]>(() =>
    toFlowNodes(diagram.groups, diagram.nodes, resiliencyByNodeId),
  );

  // Re-derive nodes when the domain model changes, carrying over the transient
  // `measured` size from the previous render so nodes remain visible.
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return toFlowNodes(diagram.groups, diagram.nodes, resiliencyByNodeId).map((n) => {
        const old = prevById.get(n.id);
        return old?.measured ? { ...n, measured: old.measured } : n;
      });
    });
  }, [diagram.groups, diagram.nodes, resiliencyByNodeId]);

  // Re-frame the viewport whenever the set of nodes/groups changes structurally
  // (new document, AI generation, import). Without this the viewport can be left
  // pointing away from freshly loaded content, so nothing appears on screen.
  const structureKey = useMemo(
    () => [...diagram.groups.map((g) => g.id), ...diagram.nodes.map((n) => n.id)].join('|'),
    [diagram.groups, diagram.nodes],
  );
  useEffect(() => {
    if (diagram.nodes.length === 0 && diagram.groups.length === 0) return;
    const raf = requestAnimationFrame(() => {
      void fitView({ padding: 0.2, duration: 300 });
    });
    return () => cancelAnimationFrame(raf);
  }, [structureKey, fitView, diagram.nodes.length, diagram.groups.length]);

  const nodeById = useMemo(
    () => new Map(diagram.nodes.map((node) => [node.id, node])),
    [diagram.nodes],
  );

  // Pan the viewport so the newly selected node or group is centred, keeping the
  // current zoom so the diagram itself is untouched — only its framing changes.
  // Tracks the last centred id so re-selecting the same item (e.g. at drag start)
  // does not fight the user's interaction with an unwanted animation.
  const centeredSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selection || selection.type === 'edge') {
      centeredSelectionRef.current = null;
      return;
    }
    if (centeredSelectionRef.current === selection.id) return;
    const raf = requestAnimationFrame(() => {
      const internal = getInternalNode(selection.id);
      if (!internal) return;
      const width = internal.measured?.width ?? 0;
      const height = internal.measured?.height ?? 0;
      // Bail (without recording the id) until the node has been measured, so a
      // later render — once dimensions are known — retries and centres on the
      // true middle rather than the top-left corner.
      if (width === 0 && height === 0) return;
      const { x, y } = internal.internals.positionAbsolute;
      centeredSelectionRef.current = selection.id;
      void setCenter(x + width / 2, y + height / 2, {
        zoom: getViewport().zoom,
        duration: 300,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [selection, rfNodes, getInternalNode, getViewport, setCenter]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      diagram.edges.map((e) => {
        const sourceNode = nodeById.get(e.source);
        const category = sourceNode
          ? (getServiceDefinition(sourceNode.serviceId)?.category ?? 'management')
          : 'management';
        const color = categoryHex[category];

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          selected: selection?.type === 'edge' && selection.id === e.id,
          type: 'azureEdge',
          animated: e.kind === 'data',
          style: { stroke: color },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
        };
      }),
    [diagram.edges, nodeById, selection],
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => select({ type: 'edge', id: edge.id }),
    [select],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) addEdge(c.source, c.target);
    },
    [addEdge],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Apply every change locally so React Flow's own bookkeeping (measured
      // dimensions, selection) stays consistent, then propagate the structural
      // changes we care about back into the store.
      setRfNodes((prev) => applyNodeChanges(changes, prev));
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          const isGroup = diagram.groups.some((g) => g.id === change.id);
          if (isGroup) updateGroup(change.id, { position: change.position });
          else updateNodePosition(change.id, change.position);
        }
        if (change.type === 'dimensions' && change.dimensions) {
          const isGroup = diagram.groups.some((g) => g.id === change.id);
          if (isGroup) updateGroup(change.id, { size: change.dimensions });
        }
        if (change.type === 'remove') {
          if (diagram.groups.some((g) => g.id === change.id)) removeGroup(change.id);
          else removeNode(change.id);
        }
      }
    },
    [diagram.groups, updateGroup, updateNodePosition, removeGroup, removeNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) if (change.type === 'remove') removeEdge(change.id);
    },
    [removeEdge],
  );

  const onSelectionChange = useCallback(
    ({ nodes, edges }: OnSelectionChangeParams) => {
      const firstNode = nodes[0];
      const firstEdge = edges[0];
      if (firstNode) {
        const isGroup = diagram.groups.some((g) => g.id === firstNode.id);
        select({ type: isGroup ? 'group' : 'node', id: firstNode.id });
      } else if (firstEdge) {
        select({ type: 'edge', id: firstEdge.id });
      }
    },
    [diagram.groups, select],
  );

  const onPaneClick = useCallback(() => select(null), [select]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const serviceId = event.dataTransfer.getData('application/x-aar-service');
      if (!serviceId || !getServiceDefinition(serviceId)) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(serviceId, position);
    },
    [screenToFlowPosition, addNode],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.ctrlKey || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      modifierPanRef.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        viewport: getViewport(),
      };
      setModifierPanning(true);
    },
    [getViewport],
  );

  const onPointerMoveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pan = modifierPanRef.current;
      if (!pan || pan.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      void setViewport({
        x: pan.viewport.x + event.clientX - pan.start.x,
        y: pan.viewport.y + event.clientY - pan.start.y,
        zoom: pan.viewport.zoom,
      });
    },
    [setViewport],
  );

  const endModifierPan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pan = modifierPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    modifierPanRef.current = null;
    setModifierPanning(false);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`h-full w-full${controlPressed ? ' aar-modifier-pan' : ''}${modifierPanning ? ' aar-modifier-panning' : ''}`}
      data-testid="canvas"
      onPointerDownCapture={onPointerDownCapture}
      onPointerMoveCapture={onPointerMoveCapture}
      onPointerUpCapture={endModifierPan}
      onPointerCancelCapture={endModifierPan}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={onEdgeClick}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onPaneClick={onPaneClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodesDraggable={!controlPressed}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        colorMode={theme}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        {showGrid && <Background variant={BackgroundVariant.Dots} gap={16} size={1} />}
        <MiniMap pannable zoomable position="bottom-left" className="!bg-card" />
      </ReactFlow>
    </div>
  );
}

export function Canvas(): JSX.Element {
  return <CanvasInner />;
}