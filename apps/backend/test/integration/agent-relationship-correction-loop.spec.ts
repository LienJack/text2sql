import { BuildSemanticQueryNode } from "../../src/modules/conversation/agent/nodes/build-semantic-query.node";
import { SqlCorrectionService } from "../../src/modules/conversation/agent/v2/sql-correction.service";

describe("agent relationship correction loop", () => {
  const correctionService = new SqlCorrectionService();
  const shouldRetryCorrection = (input: { error: string; retryCount: number }) => {
    const decision = correctionService.decide(input.error);
    return decision.correctable && input.retryCount < decision.maxAttempts;
  };

  it("retries only when relationship-path errors are detected within retry budget", () => {
    expect(
      shouldRetryCorrection({
        error: "cannot resolve join path for relationship binding",
        retryCount: 0
      })
    ).toBe(true);
    expect(
      shouldRetryCorrection({
        error: "relationship binding mismatch",
        retryCount: 1
      })
    ).toBe(true);
  });

  it("stops retrying after v2 correction max attempts", () => {
    expect(correctionService.maxAttempts).toBe(2);
    expect(
      shouldRetryCorrection({
        error: "ambiguous_join_path",
        retryCount: 2
      })
    ).toBe(false);
  });

  it("does not retry for non-relationship execution errors", () => {
    expect(
      shouldRetryCorrection({
        error: "network timeout when contacting datasource",
        retryCount: 0
      })
    ).toBe(false);
  });

  it("retries for correctable syntax/column/dialect style execution errors", () => {
    expect(
      shouldRetryCorrection({
        error: "SQL syntax error near FROM",
        retryCount: 0
      })
    ).toBe(true);
    expect(
      shouldRetryCorrection({
        error: "unknown column `foo`",
        retryCount: 1
      })
    ).toBe(true);
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

  it("keeps fallback explainable for degraded context with unpinned relationship retries", async () => {
    const node = new BuildSemanticQueryNode({
      resolve: jest.fn().mockResolvedValue({
        lockStatus: "fallback",
        semanticVersion: 13,
        fallbackApplied: true,
        degradeReason: "semantic_version_not_found",
        riskTags: ["semantic_registry_degraded"],
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
        context_pack: {
          context_pack_status: "degraded",
          instruction_sets: {
            relationship_bindings: ["rel.orders_customers"]
          }
        }
      } as never
    });

    expect(semanticPlan.status).toBe("degraded");
    expect(semanticPlan.lockStatus).toBe("fallback");
    expect(semanticPlan.fallbackApplied).toBe(true);
    expect(semanticPlan.riskTags).toEqual(
      expect.arrayContaining([
        "semantic_registry_degraded",
        "modeling_revision_context_missing",
        "semantic_context_pack_degraded"
      ])
    );
    expect(semanticPlan.semanticHints).toEqual(
      expect.arrayContaining([
        "relationship_retry_revision_unpinned",
        "modeling_revision_context_missing",
        "semantic_context_pack_degraded"
      ])
    );
    expect(semanticPlan.summary).toContain("modelingRevision=missing");
    expect(semanticPlan.summary).toContain("contextPackStatus=degraded");
  });
});
