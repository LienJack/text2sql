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
    expect(result.validation.reasons).toEqual(
      expect.arrayContaining(["plan_missing_selected_tables", "plan_missing_grounding_evidence"])
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
    expect(result.validation.routeKind).toBe("fail_closed");
    expect(result.validation.terminal).toBe(true);
  });
});
