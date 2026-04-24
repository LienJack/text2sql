import { describe, expect, it } from "vitest";
import {
  computeElkLayout,
  type ElkLayoutEngine
} from "@/components/settings/modeling/layout/elk-layout";
import type { ElkLayoutInputGraph } from "@/components/settings/modeling/layout/elk-layout.types";

function createLinearGraph(nodeCount: number): ElkLayoutInputGraph {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index + 1}`
  }));
  const edges = nodes.slice(1).map((node, index) => ({
    id: `edge-${index + 1}`,
    source: `node-${index + 1}`,
    target: node.id
  }));
  return {
    nodes,
    edges
  };
}

describe("computeElkLayout", () => {
  it("returns deterministic positions even when input order changes", async () => {
    const deterministicEngine: ElkLayoutEngine = {
      async layout(graph) {
        return {
          ...graph,
          children: (graph.children ?? []).map((child, index) => ({
            ...child,
            x: index * 200,
            y: index * 120
          }))
        };
      }
    };
    const forward: ElkLayoutInputGraph = {
      nodes: [{ id: "node-a" }, { id: "node-b" }, { id: "node-c" }],
      edges: [
        { id: "edge-ab", source: "node-a", target: "node-b" },
        { id: "edge-bc", source: "node-b", target: "node-c" }
      ]
    };
    const reverse: ElkLayoutInputGraph = {
      nodes: [{ id: "node-c" }, { id: "node-b" }, { id: "node-a" }],
      edges: [
        { id: "edge-bc", source: "node-b", target: "node-c" },
        { id: "edge-ab", source: "node-a", target: "node-b" }
      ]
    };

    const forwardResult = await computeElkLayout(forward, { engine: deterministicEngine });
    const reverseResult = await computeElkLayout(reverse, { engine: deterministicEngine });

    expect(forwardResult.ok).toBe(true);
    expect(reverseResult.ok).toBe(true);
    if (!forwardResult.ok || !reverseResult.ok) {
      return;
    }
    expect(forwardResult.positions).toEqual(reverseResult.positions);
  });

  it("returns stable empty mapping for empty graph and single mapping for single node graph", async () => {
    const emptyResult = await computeElkLayout({
      nodes: [],
      edges: []
    });
    expect(emptyResult).toMatchObject({
      ok: true,
      positions: {}
    });

    const singleNodeResult = await computeElkLayout({
      nodes: [{ id: "only-node" }],
      edges: []
    });
    expect(singleNodeResult.ok).toBe(true);
    if (!singleNodeResult.ok) {
      return;
    }
    expect(Object.keys(singleNodeResult.positions)).toEqual(["only-node"]);
  });

  it("returns controlled invalid_graph failure for unmappable edge endpoints", async () => {
    const result = await computeElkLayout({
      nodes: [{ id: "existing-node" }],
      edges: [{ id: "invalid-edge", source: "existing-node", target: "missing-node" }]
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("invalid_graph");
  });

  it("returns controlled compute_error failure when engine throws", async () => {
    const throwingEngine: ElkLayoutEngine = {
      async layout() {
        throw new Error("elk crashed");
      }
    };
    const result = await computeElkLayout(
      {
        nodes: [{ id: "node-a" }, { id: "node-b" }],
        edges: [{ id: "edge-ab", source: "node-a", target: "node-b" }]
      },
      { engine: throwingEngine }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("compute_error");
  });

  it("returns controlled timeout failure when engine stalls", async () => {
    const stalledEngine: ElkLayoutEngine = {
      layout() {
        return new Promise(() => {
          return undefined;
        });
      }
    };
    const result = await computeElkLayout(
      {
        nodes: [{ id: "node-a" }, { id: "node-b" }],
        edges: [{ id: "edge-ab", source: "node-a", target: "node-b" }]
      },
      { engine: stalledEngine, timeoutMs: 20 }
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("timeout");
  });

  it("returns a complete position map for 100 nodes and 150 edges within baseline timing budget", async () => {
    const linearGraph = createLinearGraph(100);
    const additionalEdges = Array.from({ length: 51 }, (_, index) => ({
      id: `edge-cross-${index + 1}`,
      source: `node-${(index % 75) + 1}`,
      target: `node-${Math.min(100, index + 25)}`
    })).slice(0, 51);
    let nowCall = 0;
    const fastEngine: ElkLayoutEngine = {
      async layout(graph) {
        return {
          ...graph,
          children: (graph.children ?? []).map((child, index) => ({
            ...child,
            x: index * 24,
            y: Math.floor(index / 10) * 80
          }))
        };
      }
    };

    const result = await computeElkLayout({
      nodes: linearGraph.nodes,
      edges: [...linearGraph.edges, ...additionalEdges]
    }, {
      engine: fastEngine,
      now: () => {
        nowCall += 1;
        return nowCall * 200;
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(Object.keys(result.positions)).toHaveLength(100);
    expect(result.elapsedMs).toBeLessThanOrEqual(2000);
  });
});
