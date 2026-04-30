import { SqlPromptBuilder } from "../../src/modules/conversation/agent/sql/sql-prompt.builder";

describe("SqlPromptBuilder", () => {
  it("should build sql-specific prompt payload", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单状态分布");

    expect(prompt.systemPrompt).toContain("read-only SQL");
    expect(prompt.userPrompt).toContain("Question: 统计订单状态分布");
  });

  it("injects runtime template overlay when provided", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单状态分布", "sqlite", undefined, {
      templateOverlay: "Always join users table with explicit alias."
    });

    expect(prompt.systemPrompt).toContain("Runtime template overlay");
    expect(prompt.systemPrompt).toContain("cannot override Smart Defaults");
    expect(prompt.systemPrompt).toContain("Always join users table with explicit alias.");
  });

  it("places Smart Defaults baseline before supplemental template overlay", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单状态分布", "sqlite", undefined, {
      smartDefaultsBlock:
        "Text2SQL Smart Defaults text2sql-smart-defaults@2026-04-28: only-use-context-pack",
      templateOverlay: "Prefer short aliases."
    });

    expect(prompt.systemPrompt.indexOf("Text2SQL Smart Defaults")).toBeLessThan(
      prompt.systemPrompt.indexOf("Runtime template overlay")
    );
    expect(prompt.systemPrompt).toContain("Prefer short aliases.");
  });

  it("adds explicit count-intent guardrail instructions", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单总数", "sqlite", undefined, {
      semanticGuardrail: {
        intent: "count"
      }
    });

    expect(prompt.systemPrompt).toContain("business count-intent query");
    expect(prompt.systemPrompt).toContain("must contain COUNT(...) aggregation");
    expect(prompt.systemPrompt).toContain("Do not return schema/metadata introspection SQL.");
    expect(prompt.systemPrompt).toContain(
      "Do not query schema system tables via tools"
    );
  });

  it("adds explicit metadata-intent guardrail instructions", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("数据库有哪些表", "sqlite", undefined, {
      semanticGuardrail: {
        intent: "metadata"
      }
    });

    expect(prompt.systemPrompt).toContain("metadata-intent query");
    expect(prompt.systemPrompt).toContain("sqlite_master");
    expect(prompt.systemPrompt).toContain("Do not return business row counting SQL.");
  });

  it("adds single-retry repair hint when retry reason is present", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单总数", "sqlite", undefined, {
      semanticGuardrail: {
        intent: "count",
        retryReason: "count-intent requires COUNT(...) aggregation"
      }
    });

    expect(prompt.systemPrompt).toContain("single automatic retry");
    expect(prompt.systemPrompt).toContain("count-intent requires COUNT(...) aggregation");
  });

  it("injects structured semantic instruction block before free-text context", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("按 GMV 汇总订单", "sqlite", undefined, {
      semanticContextPack: {
        status: "ready",
        semantic_lock_status: "locked",
        semantic_bindings: {
          model_keys: ["model.orders"],
          relationship_keys: ["rel.orders_customers"],
          metric_keys: ["metric.gmv"],
          calculated_field_keys: []
        },
        instruction_sets: {
          model_bindings: ["model.orders"],
          relationship_bindings: ["rel.orders_customers"],
          metric_bindings: ["metric.gmv"],
          calculated_field_bindings: []
        },
        selected_context_summary: {
          count: 0,
          snippets: []
        },
        degrade_reasons: [],
        risk_tags: []
      }
    });

    expect(prompt.systemPrompt).toContain(
      "Structured semantic instruction set (higher priority than free-text context)"
    );
    expect(prompt.systemPrompt).toContain("Metric bindings: metric.gmv");
    expect(prompt.systemPrompt).toContain(
      "Relationship bindings: rel.orders_customers"
    );
  });

  it("renders selected context asset provenance in prompt snippets", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单 GMV", "sqlite", [
      {
        chunk_id: "chunk-orders-description",
        content: "Orders table stores paid order facts.",
        metadata: {
          datasourceId: "ds-1",
          indexVersionId: "idx-1",
          chunkId: "chunk-orders-description",
          domain: "semantic_asset",
          assetFamily: "table_description",
          manifestFingerprint: "semantic-assets-prompt-v1",
          sourceVersion: "schema-v1",
          tableNames: ["orders"],
          columnNames: [],
          sourceMetadata: {}
        }
      }
    ]);

    expect(prompt.userPrompt).toContain(
      "[semantic_asset | family=table_description | manifest=semantic-assets-prompt-v1 | sourceVersion=schema-v1]"
    );
  });

  it("renders semantic-plan guardrails including coverage gaps and snapshot id", () => {
    const builder = new SqlPromptBuilder();
    const prompt = builder.build("统计订单 GMV", "sqlite", undefined, {
      semanticPlan: {
        route: "answer",
        standaloneQuestion: "统计订单 GMV",
        selectedTables: ["orders", "customers"],
        selectedColumns: ["orders.amount", "orders.customer_id", "customers.id"],
        confidence: 0.91,
        evidenceRefs: ["chunk-orders-1"],
        filters: ["route_kind:text_to_sql"],
        joinPath: ["orders->customers"],
        coverageGaps: [
          {
            gapType: "evidence_gap",
            subjectKind: "join_path",
            reasonCode: "relationship_path_needs_review",
            evidenceRefs: ["chunk-orders-1"],
            impactScope: "sql_generation"
          }
        ],
        snapshotId: "semantic-plan:text-to-sql:ready:t2:c3:e1:g1:orders"
      }
    });

    expect(prompt.systemPrompt).toContain("Typed semantic plan (must follow):");
    expect(prompt.systemPrompt).toContain(
      "coverageGaps=join_path:relationship_path_needs_review"
    );
    expect(prompt.systemPrompt).toContain(
      "snapshotId=semantic-plan:text-to-sql:ready:t2:c3:e1:g1:orders"
    );
    expect(prompt.systemPrompt).toContain(
      "Execution guardrail: stay within selectedTables/selectedColumns"
    );
  });
});
