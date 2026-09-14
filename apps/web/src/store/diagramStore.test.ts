import { beforeEach, describe, expect, it } from 'vitest';
import { useDiagramStore } from './diagramStore.js';

beforeEach(() => {
  useDiagramStore.getState().reset();
});

describe('removeGroup', () => {
  it('cascade-deletes contained nodes, nested groups, and their edges', () => {
    const store = useDiagramStore.getState();
    const rgId = store.addGroup('resourceGroup', { x: 0, y: 0 });
    const vnetId = store.addGroup('vnet', { x: 10, y: 10 });

    // Nest the vnet inside the resource group (updateGroup only patches
    // label/position/size, so set parentId directly on the store state).
    useDiagramStore.setState((s) => ({
      diagram: {
        ...s.diagram,
        groups: s.diagram.groups.map((g) => (g.id === vnetId ? { ...g, parentId: rgId } : g)),
      },
    }));

    const insideNodeId = useDiagramStore.getState().addNode('app-service', { x: 20, y: 20 });
    const nestedNodeId = useDiagramStore.getState().addNode('app-service', { x: 30, y: 30 });
    const outsideNodeId = useDiagramStore.getState().addNode('app-service', { x: 200, y: 200 });

    // Parent nodes to the groups.
    useDiagramStore.setState((s) => ({
      diagram: {
        ...s.diagram,
        nodes: s.diagram.nodes.map((n) => {
          if (n.id === insideNodeId) return { ...n, parentId: rgId };
          if (n.id === nestedNodeId) return { ...n, parentId: vnetId };
          return n;
        }),
      },
    }));

    useDiagramStore.getState().addEdge(insideNodeId, nestedNodeId);
    useDiagramStore.getState().addEdge(insideNodeId, outsideNodeId);
    // An edge entirely outside the deleted group must be preserved.
    const secondOutsideNodeId = useDiagramStore
      .getState()
      .addNode('app-service', { x: 240, y: 240 });
    useDiagramStore.getState().addEdge(outsideNodeId, secondOutsideNodeId);

    useDiagramStore.getState().removeGroup(rgId);

    const { diagram } = useDiagramStore.getState();
    expect(diagram.groups.map((g) => g.id)).toEqual([]);
    expect(diagram.nodes.map((n) => n.id).sort()).toEqual(
      [outsideNodeId, secondOutsideNodeId].sort(),
    );
    expect(diagram.edges.map((e) => [e.source, e.target])).toEqual([
      [outsideNodeId, secondOutsideNodeId],
    ]);
  });
});
