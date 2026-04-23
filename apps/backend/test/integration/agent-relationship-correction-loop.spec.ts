import {
  MAX_RELATIONSHIP_CORRECTION_RETRY,
  shouldRetryRelationshipCorrection
} from "../../src/modules/conversation/agent/graph/langgraph.state";
import { BuildSemanticQueryNode } from "../../src/modules/conversation/agent/nodes/build-semantic-query.node";

describe("agent relationship correction loop", () => {
  it("retries only when relationship-path errors are detected within retry budget", () => {
    expect(
      shouldRetryRelationshipCorrection({
        error: "missing_relation_path: cannot resolve join path",
        retryCount: 0
      })
    ).toBe(true);
    expect(
      shouldRetryRelationshipCorrection({
        error: "join_key_mismatch on relationship binding",
        retryCount: 1
      })
    ).toBe(true);
  });

  it("stops retrying after MAX_RELATIONSHIP_CORRECTION_RETRY", () => {
    expect(MAX_RELATIONSHIP_CORRECTION_RETRY).toBe(2);
    expect(
      shouldRetryRelationshipCorrection({
        error: "ambiguous_join_path",
        retryCount: 2
      })
    ).toBe(false);
  });

  it("does not retry for non-relationship execution errors", () => {
    expect(
      shouldRetryRelationshipCorrection({
        error: "SQL syntax error near SELECT",
        retryCount: 0
      })
    ).toBe(false);
  });

  it("pins relationship retry hints when context pack includes modeling revision", async () => {
    const node = new BuildSemanticQueryNode({
      resolve: jest.fn().mockResolvedValue({
        lockStatus: "locked",
        semanticVersion: 7,
        fallbackApplied: false,
        riskTags: [],
        domain: "semantic_term",
        term: "gmv"
      })
    } as never);

    const semanticPlan = await node.run({
      intentPlan: {
        status: "ready",
        intent: "aggregate",
        constraints: [],
        summary: "ok"
      },
      question: "gmv",
      retrievalBundle: {
        context_pack: {
          modeling_revision: "17",
          instruction_sets: {
            model_bindings: ["model.orders"],
            relationship_bindings: ["rel.orders_customers"],
            metric_bindings: ["metric.gmv"],
            calculated_field_bindings: ["cf.net_amount"]
          }
        }
      } as never
    });

    expect(semanticPlan.modelingRevision).toBe(17);
    expect(semanticPlan.semanticBindingSummary).toEqual({
      modelBindingCount: 1,
      relationshipBindingCount: 1,
      metricBindingCount: 1,
      calculatedFieldBindingCount: 1,
      contextPackStatus: undefined,
      modelingRevision: 17
    });
    expect(semanticPlan.semanticHints).toEqual(
      expect.arrayContaining([
        "prefer_structured_relationship_bindings",
        "relationship_retry_revision_pinned",
        "modeling_revision_context_available"
      ])
    );
    expect(semanticPlan.summary).toContain("modelingRevision=17");
  });

  it("marks relationship retry as unpinned when revision context is missing", async () => {
    const node = new BuildSemanticQueryNode({
      resolve: jest.fn().mockResolvedValue({
        lockStatus: "locked",
        semanticVersion: 7,
        fallbackApplied: false,
        riskTags: [],
        domain: "semantic_term",
        term: "gmv"
      })
    } as never);

    const semanticPlan = await node.run({
      intentPlan: {
        status: "ready",
        intent: "detail",
        constraints: [],
        summary: "ok"
      },
      question: "customer",
      retrievalBundle: {
        context_pack: {
          instruction_sets: {
            relationship_bindings: ["rel.orders_customers"]
          }
        }
      } as never
    });

    expect(semanticPlan.modelingRevision).toBeUndefined();
    expect(semanticPlan.semanticHints).toEqual(
      expect.arrayContaining([
        "relationship_retry_revision_unpinned",
        "modeling_revision_context_missing"
      ])
    );
    expect(semanticPlan.summary).toContain("modelingRevision=missing");
  });

  it("reads camelCase contextPack payloads and object-form instruction bindings", async () => {
    const node = new BuildSemanticQueryNode({
      resolve: jest.fn().mockResolvedValue({
        lockStatus: "locked",
        semanticVersion: 11,
        fallbackApplied: false,
        riskTags: [],
        domain: "semantic_term",
        term: "orders"
      })
    } as never);

    const semanticPlan = await node.run({
      intentPlan: {
        status: "ready",
        intent: "aggregate",
        constraints: [],
        summary: "ok"
      },
      question: "orders",
      retrievalBundle: {
        contextPack: {
          status: "ready",
          modelingRevision: 31,
          instructionSets: {
            modelBindings: [{ key: "model.orders" }],
            relationshipBindings: [{ key: "rel.orders_customers" }],
            metricBindings: [{ binding: "metric.gmv" }],
            calculatedFieldBindings: [{ name: "cf.net_amount" }]
          }
        }
      } as never
    });

    expect(semanticPlan.modelingRevision).toBe(31);
    expect(semanticPlan.semanticBindingSummary).toEqual({
      modelBindingCount: 1,
      relationshipBindingCount: 1,
      metricBindingCount: 1,
      calculatedFieldBindingCount: 1,
      contextPackStatus: "ready",
      modelingRevision: 31
    });
    expect(semanticPlan.summary).toContain("contextPackStatus=ready");
  });
});
