import { SemanticContextPackService } from "../../src/modules/conversation/agent/v2/semantic-context-pack.service";

describe("text2sql v2 semantic context pack", () => {
  const service = new SemanticContextPackService();

  it("collects selected tables, columns, evidence ids, and source disclosure warnings", () => {
    const pack = service.build({
      retrievalBundle: {
        status: "ready",
        selected_context: [
          {
            chunk_id: "schema-orders",
            metadata: {
              tableNames: ["Orders"],
              columnNames: ["Orders.ID", "Orders.Amount"]
            }
          },
          {
            chunk_id: "example-paid-orders",
            metadata: {
              tableNames: ["orders"],
              columnNames: ["orders.status"]
            }
          }
        ],
        context_pack: {
          semantic_bindings: {
            model_keys: ["model.orders"],
            relationship_keys: ["rel.orders_customers"],
            metric_keys: ["metric.gmv"],
            calculated_field_keys: ["cf.net_amount"]
          },
          lane_metadata: [
            {
              lane: "relationship",
              state: "ready",
              evidence_ids: ["rel.orders_customers"],
              reason_codes: ["relationship_binding_selected"]
            },
            {
              lane: "metric",
              state: "ready",
              evidence_ids: ["metric.gmv"],
              reason_codes: ["metric_binding_selected"]
            },
            {
              lane: "instruction",
              state: "ready",
              evidence_ids: ["instruction.readonly"],
              reason_codes: ["instruction_selected"]
            },
            {
              lane: "saved_prior_sql",
              state: "ready",
              evidence_ids: ["prior.sql.001"],
              reason_codes: ["prior_sql_selected"]
            },
            {
              lane: "ddl_supplement",
              state: "ready",
              evidence_ids: ["ddl.orders"],
              reason_codes: ["ddl_supplement_selected"]
            }
          ]
        }
      }
    });

    expect(pack.status).toBe("ready");
    expect(pack.selectedEvidenceIds).toEqual(
      expect.arrayContaining([
        "schema-orders",
        "example-paid-orders",
        "rel.orders_customers",
        "metric.gmv",
        "instruction.readonly",
        "prior.sql.001",
        "ddl.orders"
      ])
    );
    expect(pack.selectedTables).toEqual(["orders", "model.orders"]);
    expect(pack.selectedColumns).toEqual([
      "orders.id",
      "orders.amount",
      "orders.status"
    ]);
    expect(pack.warnings).toEqual(
      expect.arrayContaining([
        "relationship_reason:relationship_binding_selected",
        "metric_reason:metric_binding_selected",
        "instruction_reason:instruction_selected",
        "saved_prior_sql_reason:prior_sql_selected",
        "ddl_supplement_reason:ddl_supplement_selected"
      ])
    );
  });

  it("records dense unavailable, rerank unavailable, and pruning decisions explicitly", () => {
    const pack = service.build({
      retrievalBundle: {
        status: "degraded",
        selected_context: [],
        degrade_reasons: ["lexical_fallback_used"],
        lane_results: {
          dense: {
            status: "degraded",
            degrade_reason: "dense_unavailable:provider_missing"
          }
        },
        rerank_metadata: {
          secondary: {
            status: "degraded",
            unavailable_reason: "secondary_rerank_timeout"
          }
        },
        context_pack: {
          lane_metadata: [
            {
              lane: "dense",
              state: "unavailable",
              unavailable_reason: "provider_missing",
              reason_codes: ["embedding_provider_missing"]
            },
            {
              lane: "rerank",
              state: "degraded",
              fallback_reason: "deterministic_primary_ranking",
              reason_codes: ["secondary_rerank_timeout"]
            }
          ],
          pruning_decisions: [
            {
              budget_source: "token_budget",
              reason_codes: ["removed_low_score_examples"],
              summary: "removed 3 low-score examples"
            }
          ],
          permission_filtering: {
            status: "applied",
            denied_evidence_ids: ["chunk-secret-orders"],
            denied_table_names: ["secret_orders"],
            denied_column_names: ["secret_orders.internal_note"],
            reason_codes: ["permission_filtered_not_in_allowed_tables"]
          }
        },
        permission_filtering: {
          status: "applied",
          denied_evidence_ids: ["chunk-secret-orders"],
          denied_table_names: ["secret_orders"],
          denied_column_names: ["secret_orders.internal_note"],
          reason_codes: ["permission_filtered_not_in_allowed_tables"]
        }
      },
      additionalWarnings: ["context_source_disclosure:retrieval_bundle"]
    });

    expect(pack.status).toBe("degraded");
    expect(pack.warnings).toEqual(
      expect.arrayContaining([
        "lexical_fallback_used",
        "dense_unavailable:dense_unavailable:provider_missing",
        "rerank_unavailable:secondary_rerank_timeout",
        "dense_state:unavailable",
        "rerank_state:degraded",
        "dense_unavailable:provider_missing",
        "dense_reason:embedding_provider_missing",
        "rerank_degraded:deterministic_primary_ranking",
        "rerank_reason:secondary_rerank_timeout",
        "pruning_summary:removed 3 low-score examples",
        "pruning_token_budget:removed_low_score_examples",
        "permission_filter_status:applied",
        "permission_filter_reason:permission_filtered_not_in_allowed_tables",
        "permission_denied_table:secret_orders",
        "permission_denied_column:secret_orders.internal_note",
        "permission_denied_evidence_count:1",
        "context_source_disclosure:retrieval_bundle"
      ])
    );
  });

  it("deduplicates evidence ids and caps large evidence lists", () => {
    const pack = service.build({
      selectedContext: Array.from({ length: 80 }, (_, index) => ({
        chunk_id: `chunk-${index % 70}`,
        metadata: {
          tableNames: ["orders"],
          columnNames: ["orders.id"]
        }
      }))
    });

    expect(pack.selectedEvidenceIds).toHaveLength(64);
    expect(new Set(pack.selectedEvidenceIds).size).toBe(64);
  });
});
