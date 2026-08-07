import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge as rfAddEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo, useRef } from 'react';
import { getServiceDefinition } from '@aar/shared';
import { AzureNode } from './AzureNode.js';
import { GroupNode } from './GroupNode.js';
import { useDiagramStore } from '@/store/diagramStore.js';

const nodeTypes = { azureNode: AzureNode, azureGroup: GroupNode };

function toFlowNodes(
  groups: ReturnType<typeof useDiagramStore.getState>['diagram']['groups'],
  nodes: ReturnType<typeof useDiagramStore.getState>['diagram']['nodes'],
): Node[] {
  // Groups first so they render behind service nodes.
  const groupNodes: Node[] = groups.map((g) => ({
    id: g.id,
    type: 'azureGroup',
    position: g.position,
    data: { kind: g.kind, label: g.label },
    style: { width: g.size.width, height: g.size.height },
    draggable: true,
    selectable: true,
    zIndex: 0,
  }));

  const serviceNodes: Node[] = nodes.map((n) => ({
    id: n.id,
    type: 'azureNode',
    position: n.position,
    data: { serviceId: n.serviceId, label: n.label },
    ...(n.parentId ? { parentId: n.parentId, extent: 'parent' as const } : {}),
    zIndex: 1,
  }));

  return [...groupNodes, ...serviceNodes];
}

function CanvasInner(): JSX.Element {
  const diagram = useDiagramStore((s) => s.diagram);
  const select = useDiagramStore((s) => s.select);
  const addNode = useDiagramStore((s) => s.addNode);
  const addEdge = useDiagramStore((s) => s.addEdge);
  const updateNodePosition = useDiagramStore((s) => s.updateNodePosition);
  const updateGroup = useDiagramStore((s) => s.updateGroup);
  const removeNode = useDiagramStore((s) => s.removeNode);
  const removeGroup = useDiagramStore((s) => s.removeGroup);
  const removeEdge = useDiagramStore((s) => s.removeEdge);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const flowNodes = useMemo(
    () => toFlowNodes(diagram.groups, diagram.nodes),
    [diagram.groups, diagram.nodes],
  );
  const flowEdges = useMemo<Edge[]>(
    () =>
      diagram.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: e.kind === 'data',
      })),
    [diagram.edges],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) addEdge(c.source, c.target);
    },
    [addEdge],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
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
      } else {
        select(null);
      }
    },
    [diagram.groups, select],
  );

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

  return (
    <div ref={wrapperRef} className="h-full w-full" data-testid="canvas">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onDrop={onDrop}
        onDragOver={onDragOver}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <MiniMap pannable zoomable className="!bg-card" />
        <Controls className="!bg-card !text-foreground" />
      </ReactFlow>
    </div>
  );
}

export function Canvas(): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
