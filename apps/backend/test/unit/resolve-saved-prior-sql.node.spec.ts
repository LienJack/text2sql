import { ResolveSavedPriorSqlNode } from "../../src/modules/conversation/agent/nodes/resolve-saved-prior-sql.node";

describe("ResolveSavedPriorSqlNode", () => {
  it("returns shortcut SQL when lane is hit and selected chunk contains sql", () => {
    const node = new ResolveSavedPriorSqlNode();
    const result = node.run({
      question: "统计订单总数",
      retrievalBundle: {
        query: "统计订单总数",
        run_id: "run-1",
        datasource_id: "ds-1",
        status: "ready",
        degrade_reasons: [],
        lane_results: {
          lexical: {
            lane: "lexical",
            status: "ok",
            timeout_ms: 10,
            elapsed_ms: 5,
            hits: []
          },
          dense: {
            lane: "dense",
            status: "ok",
            timeout_ms: 10,
            elapsed_ms: 5,
            hits: []
          },
          graph: {
            lane: "graph",
            status: "ok",
            timeout_ms: 10,
            elapsed_ms: 5,
            hits: []
          }
        },
        candidates: [
          {
            chunk_id: "chunk-prior-1",
            source_lane: "lexical",
            score: 1,
            evidence: ["prior_sql:trusted"],
            lane_scores: {
              lexical: 1
            },
            lane_ranks: {
              lexical: 1
            },
            chunk: {
              chunk_id: "chunk-prior-1",
              content: "Question: 统计订单总数\n\nSQL:\nSELECT COUNT(*) FROM orders",
              metadata: {
                datasourceId: "ds-1",
                indexVersionId: "idx-1",
                chunkId: "chunk-prior-1",
                domain: "sql_example",
                tableNames: ["orders"],
                columnNames: ["id"],
                sourceMetadata: {
                  trusted: true,
                  priorSql: true,
                  sql: "SELECT COUNT(*) FROM orders",
                  viewId: "view.chat_run.run-1",
                  sourceRunId: "run-1"
                }
              }
            }
          }
        ],
        selected_context: [],
        prior_sql_lane: {
          status: "hit",
          matched_count: 1,
          selected_count: 1,
          filtered_count: 0,
          shortcut: {
            status: "hit",
            reason_codes: ["prior_sql_shortcut_hit"],
            matched_count: 1,
            eligible_count: 1,
            filtered_count: 0,
            stale_count: 0,
            ambiguous_count: 0,
            selected_chunk_id: "chunk-prior-1",
            selected_view_id: "view.chat_run.run-1",
            selected_source_run_id: "run-1"
          }
        }
      }
    });

    expect(result.status).toBe("hit");
    expect(result.sql).toBe("SELECT COUNT(*) FROM orders");
    expect(result.selectedChunkId).toBe("chunk-prior-1");
    expect(result.selectedViewId).toBe("view.chat_run.run-1");
    expect(result.selectedSourceRunId).toBe("run-1");
  });

  it("falls back to chunk content when structured sql field is missing", () => {
    const node = new ResolveSavedPriorSqlNode();
    const result = node.run({
      question: "统计订单总数",
      retrievalBundle: {
        query: "统计订单总数",
        run_id: "run-1",
        datasource_id: "ds-1",
        status: "ready",
        degrade_reasons: [],
        lane_results: {
          lexical: {
            lane: "lexical",
            status: "ok",
            timeout_ms: 10,
            elapsed_ms: 5,
            hits: []
          },
          dense: {
            lane: "dense",
            status: "ok",
            timeout_ms: 10,
            elapsed_ms: 5,
            hits: []
          },
          graph: {
            lane: "graph",
            status: "ok",
            timeout_ms: 10,
            elapsed_ms: 5,
            hits: []
          }
        },
        candidates: [
          {
            chunk_id: "chunk-prior-1",
            source_lane: "lexical",
            score: 1,
            evidence: ["prior_sql:trusted"],
            lane_scores: {
              lexical: 1
            },
            lane_ranks: {
              lexical: 1
            },
            chunk: {
              chunk_id: "chunk-prior-1",
              content: "Question: 统计订单总数",
              metadata: {
                datasourceId: "ds-1",
                indexVersionId: "idx-1",
                chunkId: "chunk-prior-1",
                domain: "sql_example",
                tableNames: ["orders"],
                columnNames: ["id"],
                sourceMetadata: {
                  trusted: true,
                  priorSql: true
                }
              }
            }
          }
        ],
        selected_context: [],
        prior_sql_lane: {
          status: "hit",
          matched_count: 1,
          selected_count: 1,
          filtered_count: 0
        }
      }
    });

    expect(result.status).toBe("hit");
    expect(result.sql).toBe("Question: 统计订单总数");
  });
});
