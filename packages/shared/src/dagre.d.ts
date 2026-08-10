// Minimal ambient types for the subset of @dagrejs/dagre this project uses.
declare module '@dagrejs/dagre' {
  export interface GraphLabel {
    rankdir?: 'TB' | 'BT' | 'LR' | 'RL';
    nodesep?: number;
    ranksep?: number;
    marginx?: number;
    marginy?: number;
  }
  export interface DagreNode {
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
  }
  export class Graph {
    constructor(opts?: { compound?: boolean; directed?: boolean; multigraph?: boolean });
    setGraph(label: GraphLabel): this;
    setDefaultEdgeLabel(callback: () => object): this;
    setNode(id: string, node: { width?: number; height?: number; label?: string }): this;
    setParent(child: string, parent: string): void;
    setEdge(source: string, target: string, label?: object): this;
    node(id: string): DagreNode;
    hasNode(id: string): boolean;
  }
  interface Dagre {
    graphlib: { Graph: typeof Graph };
    layout(graph: Graph): void;
  }
  const dagre: Dagre;
  export default dagre;
}
