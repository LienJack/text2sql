export const DEFAULT_ELK_DIRECTION = "RIGHT";
export const DEFAULT_ELK_NODE_WIDTH = 260;
export const DEFAULT_ELK_NODE_HEIGHT = 140;
export const DEFAULT_ELK_NODE_SPACING = 80;
export const DEFAULT_ELK_LAYER_SPACING = 140;
export const DEFAULT_ELK_EDGE_SPACING = 40;
export const DEFAULT_ELK_TIMEOUT_MS = 1800;

export type ElkLayoutDirection = "RIGHT" | "DOWN";

export type ElkLayoutInputNode = {
  id: string;
  width?: number;
  height?: number;
  position?: {
    x: number;
    y: number;
  };
};

export type ElkLayoutInputEdge = {
  id: string;
  source: string;
  target: string;
};

export type ElkLayoutInputGraph = {
  nodes: ElkLayoutInputNode[];
  edges: ElkLayoutInputEdge[];
};

export type ElkLayoutPosition = {
  x: number;
  y: number;
};

export type ElkLayoutFailureReason = "invalid_graph" | "timeout" | "compute_error";

export type ElkLayoutSuccessResult = {
  ok: true;
  positions: Record<string, ElkLayoutPosition>;
  elapsedMs: number;
};

export type ElkLayoutFailureResult = {
  ok: false;
  reason: ElkLayoutFailureReason;
  message: string;
  elapsedMs: number;
};

export type ElkLayoutResult = ElkLayoutSuccessResult | ElkLayoutFailureResult;

export type ElkLayoutExecutionOptions = {
  direction?: ElkLayoutDirection;
  timeoutMs?: number;
  nodeSpacing?: number;
  layerSpacing?: number;
  edgeSpacing?: number;
  engine?: ElkLayoutEngine;
  now?: () => number;
};

export type ElkEngineNode = {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
};

export type ElkEngineEdge = {
  id: string;
  sources: string[];
  targets: string[];
};

export type ElkEngineGraph = {
  id: string;
  layoutOptions?: Record<string, string>;
  children?: ElkEngineNode[];
  edges?: ElkEngineEdge[];
};

export type ElkLayoutEngine = {
  layout: (graph: ElkEngineGraph) => Promise<ElkEngineGraph>;
};
