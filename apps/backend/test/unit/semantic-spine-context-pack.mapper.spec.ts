import { SemanticSpineContextPackMapper } from "../../src/modules/knowledge/semantic-spine/semantic-spine-context-pack.mapper";

describe("semantic spine context-pack mapper", () => {
  it("maps ready compile output into context pack payload", () => {
    const mapper = new SemanticSpineContextPackMapper();
    const contextPack = mapper.mapToContextPack({
      compileResult: {
        confidence: {
          degraded: false,
          score: 1
        },
        evidence: {
          matchedObjectKeys: ["model.orders"],
          missingObjectKeys: []
        },
        instructionSets: {
          calculatedFieldBindings: [],
          metricBindings: [],
          modelBindings: [
            {
              binding: "public.orders",
              key: "model.orders",
              name: "orders"
            }
          ],
          relationshipBindings: []
        },
        riskTags: [],
        semanticBindings: {
          calculatedFields: {},
          metrics: {},
          models: {
            "model.orders": {
              binding: "public.orders",
              key: "model.orders",
              name: "orders"
            }
          },
          relationships: {}
        },
        semanticVersion: 3,
        status: "ready"
      },
      retrievalBundle: {
        selected_context: [
          {
            chunk_id: "chunk-1",
            content: "orders schema context",
            metadata: {
              chunkId: "chunk-1",
              datasourceId: "ds-1",
              domain: "semantic_term",
              indexVersionId: "idx-1",
              tableNames: ["orders"],
              columnNames: ["amount_paid"]
            }
          }
        ],
        status: "ready"
      }
    });

    expect(contextPack.status).toBe("ready");
    expect(contextPack.semantic_version).toBe(3);
    expect(contextPack.selected_context_summary.count).toBe(1);
    expect(contextPack.selected_context_summary.snippets[0]).toContain("orders schema context");
    expect(contextPack.degrade_reasons).toHaveLength(0);
  });

  it("marks degrade reasons and risk tags when compile/retrieval degraded", () => {
    const mapper = new SemanticSpineContextPackMapper();
    const contextPack = mapper.mapToContextPack({
      compileResult: {
        confidence: {
          degraded: true,
          score: 0
        },
        evidence: {
          degradeReason: "semantic_spine_snapshot_not_found",
          matchedObjectKeys: [],
          missingObjectKeys: ["models"]
        },
        instructionSets: {
          calculatedFieldBindings: [],
          metricBindings: [],
          modelBindings: [],
          relationshipBindings: []
        },
        riskTags: ["semantic_spine_degraded"],
        semanticBindings: {
          calculatedFields: {},
          metrics: {},
          models: {},
          relationships: {}
        },
        status: "degraded"
      },
      retrievalBundle: {
        selected_context: [],
        status: "degraded"
      }
    });

    expect(contextPack.status).toBe("degraded");
    expect(contextPack.degrade_reasons).toEqual(
      expect.arrayContaining([
        "semantic_spine_snapshot_not_found",
        "retrieval_bundle_degraded"
      ])
    );
    expect(contextPack.risk_tags).toEqual(
      expect.arrayContaining(["semantic_spine_degraded"])
    );
  });
});
