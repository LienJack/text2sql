declare module "elkjs/lib/elk.bundled.js" {
  type ElkNode = {
    id: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  };

  type ElkEdge = {
    id: string;
    sources: string[];
    targets: string[];
  };

  type ElkGraph = {
    id: string;
    layoutOptions?: Record<string, string>;
    children?: ElkNode[];
    edges?: ElkEdge[];
  };

  export default class ELK {
    constructor(options?: Record<string, unknown>);
    layout(graph: ElkGraph): Promise<ElkGraph>;
  }
}
