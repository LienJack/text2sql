import { SemanticContextPackService } from "../../src/modules/conversation/agent/v2/semantic-context-pack.service";
import { SemanticPlanService } from "../../src/modules/conversation/agent/v2/semantic-plan.service";
import { SemanticPlanValidator } from "../../src/modules/conversation/agent/v2/semantic-plan.validator";

describe("text2sql v2 semantic plan", () => {
  const contextPackService = new SemanticContextPackService();
  const validator = new SemanticPlanValidator();
  const planService = new SemanticPlanService(validator);

  it("builds selected tables/columns and evidence refs from retrieval context", () => {
    const contextPack = contextPackService.build({
      selectedContext: [
        {
          chunk_id: "chunk-orders-1",
          content: "orders table",
          metadata: {
            datasourceId: "ds-1",
            indexVersionId: "idx-1",
            chunkId: "chunk-orders-1",
            domain: "schema",
            tableNames: ["orders"],
            columnNames: ["id", "amount", "status"],
            sourceMetadata: {}
          }
        }
      ]
    });

    const result = planService.build({
      question: "统计订单总金额",
      contextPack,
      semanticIntent: "count",
      allowedTables: ["orders", "order_items"]
    });

    expect(result.plan.route).toBe("answer");
    expect(result.validation.routeKind).toBe("text_to_sql");
    expect(result.plan.selectedTables).toEqual(["orders"]);
    expect(result.plan.selectedColumns).toEqual(["id", "amount", "status"]);
    expect(result.plan.evidenceRefs).toEqual(["chunk-orders-1"]);
    expect(result.plan.snapshotId).toBe("semantic-plan:text-to-sql:ready:t1:c3:e1:g0:orders");
    expect(result.plan.coverageGaps).toBeUndefined();
    expect(result.validation.valid).toBe(true);
  });

  it("flags unsupported table selections when allowed tables are constrained", () => {
    const result = planService.build({
      question: "查询退款单",
      contextPack: {
        status: "ready",
        selectedEvidenceIds: ["chunk-refunds-1"],
        selectedTables: ["refunds"],
        selectedColumns: ["refunds.id", "refunds.amount"]
      },
      allowedTables: ["orders"]
    });

    expect(result.validation.valid).toBe(false);
    expect(result.validation.unsupportedTables).toEqual(["refunds"]);
    expect(result.validation.reasons).toEqual(
      expect.arrayContaining(["plan_contains_unsupported_tables"])
    );
  });

  it("maps metadata intent to answer route with metadata route-kind marker", () => {
    const result = planService.build({
      question: "有哪些表",
      contextPack: {
        status: "ready",
        selectedEvidenceIds: [],
        selectedTables: [],
        selectedColumns: []
      }
    });

    expect(result.plan.route).toBe("answer");
    expect(result.validation.routeKind).toBe("metadata");
    expect(result.plan.filters).toEqual(
      expect.arrayContaining(["route_kind:metadata"])
    );
  });

  it("maps general business-definition questions to non-SQL answer route", () => {
    const result = planService.build({
      question: "什么是 GMV 口径？",
      contextPack: {
        status: "ready",
        selectedEvidenceIds: ["metric.gmv"],
        selectedTables: [],
        selectedColumns: []
      }
    });

    expect(result.plan.route).toBe("answer");
    expect(result.validation.routeKind).toBe("general");
    expect(result.validation.valid).toBe(true);
    expect(result.plan.filters).toEqual(
      expect.arrayContaining(["route_kind:general"])
    );
  });

  it("keeps text_to_sql plan snapshot stable across generation validation and correction consumers", () => {
    const result = planService.build({
      question: "按月统计近30天订单 GMV",
      contextPack: {
        status: "ready",
        selectedEvidenceIds: ["chunk-orders", "metric.gmv"],
        selectedTables: ["orders", "customers"],
        selectedColumns: ["orders.amount", "orders.customer_id", "customers.id"]
      },
      allowedTables: ["orders", "customers"]
    });

    const generationPlanSnapshot = result.plan;
    const validationPlanSnapshot = result.plan;
    const correctionPlanSnapshot = result.plan;

    expect(result.validation.valid).toBe(true);
    expect(result.validation.routeKind).toBe("text_to_sql");
    expect(result.plan.metrics).toEqual(
      expect.arrayContaining(["gmv", "orders.amount"])
    );
    expect(result.plan.grain).toBe("month");
    expect(result.plan.filters).toEqual(
      expect.arrayContaining(["route_kind:text_to_sql", "time_range:relative"])
    );
    expect(result.plan.joinPath).toEqual(["orders->customers"]);
    expect(generationPlanSnapshot).toBe(validationPlanSnapshot);
    expect(validationPlanSnapshot).toBe(correctionPlanSnapshot);
  });

  it("keeps text-to-sql route when degraded context has no rag grounding", () => {
    const result = planService.build({
      question: "统计 GMV",
      contextPack: {
        status: "degraded",
        selectedEvidenceIds: [],
        selectedTables: [],
        selectedColumns: [],
        warnings: ["rag_retrieval_disabled", "dense_reason:rag_retrieval_disabled"]
      }
    });

    expect(result.plan.route).toBe("answer");
    expect(result.validation.routeKind).toBe("text_to_sql");
    expect(result.validation.requiresClarification).toBe(false);
    expect(result.validation.evidenceComplete).toBe(false);
    expect(result.validation.lowConfidence).toBe(true);
    expect(result.plan.snapshotId).toBe("semantic-plan:text-to-sql:degraded:t0:c0:e0:g1:none");
    expect(result.plan.coverageGaps).toEqual([
      expect.objectContaining({
        gapType: "evidence_gap",
        reasonCode: "missing_selected_evidence_refs",
        evidenceRefs: [],
        impactScope: "sql_generation"
      })
    ]);
    expect(result.validation.reasons).toEqual(
      expect.arrayContaining(["plan_missing_selected_tables", "plan_missing_grounding_evidence"])
    );
  });

  it("asks one clarification when grounding is incomplete and budget remains", () => {
    const result = planService.build({
      question: "统计活跃用户",
      contextPack: {
        status: "ready",
        selectedEvidenceIds: [],
        selectedTables: [],
        selectedColumns: [],
        warnings: ["clarification_round:1", "clarification_max_rounds:2"]
      }
    });

    expect(result.plan.route).toBe("clarify");
    expect(result.validation.requiresClarification).toBe(true);
    expect(result.plan.filters).toEqual(
      expect.arrayContaining([
        "route_kind:clarify",
        "clarification_round:1",
        "clarification_max_rounds:2"
      ])
    );
    expect(result.plan.coverageGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gapType: "user_decision_gap",
          reasonCode: "semantic_plan_requires_clarification",
          impactScope: "clarification"
        })
      ])
    );
  });

  it("hard-stops to fail-closed route when clarification round budget is exhausted", () => {
    const result = planService.build({
      question: "统计 GMV",
      contextPack: {
        status: "degraded",
        selectedEvidenceIds: [],
        selectedTables: [],
        selectedColumns: [],
        warnings: ["clarification_round:2", "clarification_max_rounds:2"]
      }
    });

    expect(result.plan.route).toBe("reject");
    expect(result.plan.snapshotId).toBe("semantic-plan:fail-closed:degraded:t0:c0:e0:g2:none");
    expect(result.plan.coverageGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gapType: "evidence_gap",
          reasonCode: "missing_selected_evidence_refs",
          evidenceRefs: [],
          impactScope: "sql_generation"
        }),
        expect.objectContaining({
          gapType: "user_decision_gap",
          reasonCode: "clarification_budget_exhausted",
          evidenceRefs: [],
          impactScope: "execution"
        })
      ])
    );
    expect(result.validation.routeKind).toBe("fail_closed");
    expect(result.validation.terminal).toBe(true);
  });

  it("rejects malformed coverage gap payloads during validation", () => {
    const result = validator.validate({
      plan: {
        route: "clarify",
        standaloneQuestion: "统计 GMV",
        selectedTables: [],
        selectedColumns: [],
        confidence: 0.3,
        evidenceRefs: [],
        coverageGaps: [
          {
            gapType: "user_decision_gap",
            subjectKind: "metric",
            reasonCode: "",
            evidenceRefs: "chunk-1",
            impactScope: "clarification"
          } as never
        ],
        snapshotId: "   "
      }
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "plan_invalid_coverage_gap_shape",
        "plan_missing_coverage_gaps",
        "plan_invalid_snapshot_id",
        "plan_low_confidence"
      ])
    );
  });
});
