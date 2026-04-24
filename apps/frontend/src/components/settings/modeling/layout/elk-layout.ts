import ELK from "elkjs/lib/elk.bundled.js";
import {
  DEFAULT_ELK_DIRECTION,
  DEFAULT_ELK_EDGE_SPACING,
  DEFAULT_ELK_LAYER_SPACING,
  DEFAULT_ELK_NODE_HEIGHT,
  DEFAULT_ELK_NODE_SPACING,
  DEFAULT_ELK_NODE_WIDTH,
  DEFAULT_ELK_TIMEOUT_MS,
  type ElkEngineGraph,
  type ElkLayoutEngine,
  type ElkLayoutExecutionOptions,
  type ElkLayoutInputEdge,
  type ElkLayoutInputGraph,
  type ElkLayoutInputNode,
  type ElkLayoutResult
} from "@/components/settings/modeling/layout/elk-layout.types";

class ElkLayoutTimeoutError extends Error {}

const defaultEngine: ElkLayoutEngine = new ELK();

function sortNodes(nodes: ElkLayoutInputNode[]): ElkLayoutInputNode[] {
  return [...nodes].sort((left, right) => left.id.localeCompare(right.id));
}

function sortEdges(edges: ElkLayoutInputEdge[]): ElkLayoutInputEdge[] {
  return [...edges].sort((left, right) =>
    `${left.id}:${left.source}:${left.target}`.localeCompare(
      `${right.id}:${right.source}:${right.target}`
    )
  );
}

function toElapsedMs(startTime: number, now: () => number): number {
  return Math.max(0, Math.round(now() - startTime));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return Promise.reject(new ElkLayoutTimeoutError("ELK layout timeout"));
  }
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new ElkLayoutTimeoutError("ELK layout timeout"));
    }, timeoutMs);
    void promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

export async function computeElkLayout(
  inputGraph: ElkLayoutInputGraph,
  options: ElkLayoutExecutionOptions = {}
): Promise<ElkLayoutResult> {
  const now = options.now ?? (() => performance.now());
  const startTime = now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_ELK_TIMEOUT_MS;
  const engine = options.engine ?? defaultEngine;
  const direction = options.direction ?? DEFAULT_ELK_DIRECTION;
  const nodeSpacing = options.nodeSpacing ?? DEFAULT_ELK_NODE_SPACING;
  const layerSpacing = options.layerSpacing ?? DEFAULT_ELK_LAYER_SPACING;
  const edgeSpacing = options.edgeSpacing ?? DEFAULT_ELK_EDGE_SPACING;
  const nodes = sortNodes(inputGraph.nodes ?? []);
  const edges = sortEdges(inputGraph.edges ?? []);

  const nodeIdSet = new Set<string>();
  for (const node of nodes) {
    const nodeId = node.id.trim();
    if (!nodeId || nodeIdSet.has(nodeId)) {
      return {
        ok: false,
        reason: "invalid_graph",
        message: `Invalid node id detected: "${node.id}"`,
        elapsedMs: toElapsedMs(startTime, now)
      };
    }
    nodeIdSet.add(nodeId);
  }

  for (const edge of edges) {
    if (!edge.id.trim()) {
      return {
        ok: false,
        reason: "invalid_graph",
        message: "Edge id is required",
        elapsedMs: toElapsedMs(startTime, now)
      };
    }
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) {
      return {
        ok: false,
        reason: "invalid_graph",
        message: `Edge "${edge.id}" references missing nodes`,
        elapsedMs: toElapsedMs(startTime, now)
      };
    }
  }

  if (nodes.length === 0) {
    return {
      ok: true,
      positions: {},
      elapsedMs: toElapsedMs(startTime, now)
    };
  }

  const elkGraph: ElkEngineGraph = {
    id: "modeling-workbench",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": String(nodeSpacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
      "elk.spacing.edgeNode": String(edgeSpacing),
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX"
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: node.width ?? DEFAULT_ELK_NODE_WIDTH,
      height: node.height ?? DEFAULT_ELK_NODE_HEIGHT
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target]
    }))
  };

  try {
    const result = await withTimeout(engine.layout(elkGraph), timeoutMs);
    const resultNodeMap = new Map((result.children ?? []).map((node) => [node.id, node] as const));
    const positions = nodes.reduce<Record<string, { x: number; y: number }>>((acc, node, index) => {
      const fromResult = resultNodeMap.get(node.id);
      const fallbackX =
        typeof node.position?.x === "number"
          ? node.position.x
          : (index % 4) * (node.width ?? DEFAULT_ELK_NODE_WIDTH);
      const fallbackY =
        typeof node.position?.y === "number"
          ? node.position.y
          : Math.floor(index / 4) * (node.height ?? DEFAULT_ELK_NODE_HEIGHT);
      const resolvedX = typeof fromResult?.x === "number" ? fromResult.x : fallbackX;
      const resolvedY = typeof fromResult?.y === "number" ? fromResult.y : fallbackY;
      acc[node.id] = {
        x: resolvedX,
        y: resolvedY
      };
      return acc;
    }, {});
    return {
      ok: true,
      positions,
      elapsedMs: toElapsedMs(startTime, now)
    };
  } catch (error) {
    if (error instanceof ElkLayoutTimeoutError) {
      return {
        ok: false,
        reason: "timeout",
        message: error.message,
        elapsedMs: toElapsedMs(startTime, now)
      };
    }
    return {
      ok: false,
      reason: "compute_error",
      message: error instanceof Error ? error.message : "ELK layout failed",
      elapsedMs: toElapsedMs(startTime, now)
    };
  }
}

export type { ElkLayoutEngine } from "@/components/settings/modeling/layout/elk-layout.types";
