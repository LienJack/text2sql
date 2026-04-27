import { SemanticContextPackService } from "../../src/modules/conversation/agent/v2/semantic-context-pack.service";

describe("text2sql v2 semantic context pack", () => {
  const service = new SemanticContextPackService();

  it("builds a rich versioned contract with structured lanes and selected-context summary", () => {
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
    expect(pack.version).toBe("v1.rich");
    expect(pack.capabilities).toEqual(
      expect.arrayContaining([
        "selected_context_summary",
        "semantic_binding_refs",
        "structured_lanes"
      ])
    );
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
    expect(pack.selectedContextSummary).toMatchObject({
      count: 2
    });
    expect(pack.selectedContextSummary?.evidenceIds).toEqual(
      expect.arrayContaining(["schema-orders", "example-paid-orders"])
    );
    expect(pack.selectedContextSummary).toEqual(
      expect.not.objectContaining({ snippets: expect.anything() })
    );
    expect(pack.lanes).toMatchObject({
      tables: {
        ids: ["orders", "model.orders"],
        count: 2
      },
      columns: {
        ids: ["orders.id", "orders.amount", "orders.status"],
        count: 3
      },
      relationships: {
        refs: ["rel.orders_customers"],
        count: 1
      },
      metrics: {
        refs: ["metric.gmv"],
        count: 1
      },
      instructions: {
        refs: ["instruction.readonly"],
        count: 1
      },
      priorSql: {
        refs: ["prior.sql.001"],
        count: 1
      },
      schemaSupplementRefs: {
        refs: ["ddl.orders"],
        count: 1
      },
      semanticBindings: {
        modelKeys: ["model.orders"],
        relationshipKeys: ["rel.orders_customers"],
        metricKeys: ["metric.gmv"],
        calculatedFieldKeys: ["cf.net_amount"]
      }
    });
    expect(pack.laneStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "relationship",
          state: "ready",
          refs: ["rel.orders_customers"],
          reasonCodes: ["relationship_binding_selected"]
        }),
        expect.objectContaining({
          lane: "metric",
          state: "ready",
          refs: ["metric.gmv"],
          reasonCodes: ["metric_binding_selected"]
        })
      ])
    );
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

  it("records degradation, pruning, and permission filtering as structured artifacts", () => {
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
    expect(pack.degradation).toMatchObject({
      status: "degraded",
      reasons: ["lexical_fallback_used"],
      denseUnavailableReason: "dense_unavailable:dense_unavailable:provider_missing",
      rerankUnavailableReason: "rerank_unavailable:secondary_rerank_timeout"
    });
    expect(pack.degradation?.laneIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lane: "dense",
          state: "unavailable",
          unavailableReason: "provider_missing"
        }),
        expect.objectContaining({
          lane: "rerank",
          state: "degraded",
          fallbackReason: "deterministic_primary_ranking"
        })
      ])
    );
    expect(pack.pruning).toMatchObject({
      applied: true,
      decisions: [
        expect.objectContaining({
          budgetSource: "token_budget",
          keptCount: 0,
          removedCount: 0,
          reasonCodes: ["removed_low_score_examples"],
          summary: "removed 3 low-score examples"
        })
      ]
    });
    expect(pack.permissionFiltering).toMatchObject({
      status: "applied",
      deniedEvidenceIds: ["chunk-secret-orders"],
      deniedEvidenceCount: 1,
      deniedTables: ["secret_orders"],
      deniedColumns: ["secret_orders.internal_note"],
      reasonCodes: ["permission_filtered_not_in_allowed_tables"]
    });
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
    expect(pack.selectedContextSummary?.evidenceIds.length).toBeLessThanOrEqual(24);
  });
});
