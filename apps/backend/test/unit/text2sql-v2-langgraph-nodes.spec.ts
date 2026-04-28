import { ClarifyNode } from "../../src/modules/conversation/agent/nodes/clarify.node";
import { FormatAnswerNode } from "../../src/modules/conversation/agent/nodes/format-answer.node";
import { IntakeNode } from "../../src/modules/conversation/nodes/intake.node";
import { AssembleContextNode } from "../../src/modules/conversation/nodes/assemble-context.node";
import { SemanticPlanNode } from "../../src/modules/conversation/nodes/semantic-plan.node";
import { GenerateSqlNode } from "../../src/modules/conversation/nodes/generate-sql.node";
import { ValidateSqlNode } from "../../src/modules/conversation/nodes/validate-sql.node";
import { CorrectSqlNode } from "../../src/modules/conversation/nodes/correct-sql.node";
import { ExecuteSqlNode } from "../../src/modules/conversation/nodes/execute-sql.node";
import { AnswerNode } from "../../src/modules/conversation/nodes/answer.node";
import { SemanticContextPackService } from "../../src/modules/conversation/adapters/semantic-context-pack.service";
import { SemanticPlanService } from "../../src/modules/conversation/adapters/semantic-plan.service";
import { SemanticPlanValidator } from "../../src/modules/conversation/adapters/semantic-plan.validator";
import { SqlValidationService } from "../../src/modules/conversation/adapters/sql-validation.service";
import { SqlCorrectionService } from "../../src/modules/conversation/adapters/sql-correction.service";
import type { SemanticPlanV1 } from "@text2sql/shared-types";

describe("text2sql v2 langgraph nodes", () => {
  const readyPlan: SemanticPlanV1 = {
    route: "answer",
    standaloneQuestion: "统计订单总数",
    selectedTables: ["orders"],
    selectedColumns: ["orders.id"],
    confidence: 0.9,
    evidenceRefs: ["chunk-orders-1"],
    filters: ["route_kind:text_to_sql"],
    snapshotId: "semantic-plan:text-to-sql:ready:t1:c1:e1:g0:orders"
  };

  describe("intake node", () => {
    const node = new IntakeNode(new ClarifyNode());

    it("routes metadata and general questions to no-sql direct answers", () => {
      expect(node.run({ question: "有哪些表" })).toMatchObject({
        route: "metadata",
        semanticIntent: "metadata",
        directAnswer:
          "这是元数据问题，我会基于可访问的表结构与语义证据直接说明，不执行 SQL。"
      });

      expect(node.run({ question: "什么是 GMV 口径？" })).toMatchObject({
        route: "general",
        semanticIntent: "general"
      });
    });

    it("routes unsafe and unsupported requests to fail-closed compatible intake failures", () => {
      expect(node.run({ question: "DELETE FROM orders" })).toMatchObject({
        route: "unsafe",
        failure: {
          code: "INTAKE_UNSAFE_REQUEST",
          terminal: true,
          correctable: false
        }
      });

      expect(node.run({ question: "帮我发邮件给财务" })).toMatchObject({
        route: "unsupported",
        failure: {
          code: "INTAKE_UNSUPPORTED_REQUEST",
          terminal: true,
          correctable: false
        }
      });
    });

    it("routes incomplete questions to clarification and rewrites follow-up questions with context", () => {
      const clarification = node.run({ question: "统计 GMV" });
      expect(clarification.route).toBe("needs_clarification");
      expect(clarification.clarification?.question).toContain("分析对象");

      const followUp = node.run({
        question: "那最近30天呢",
        contextEnvelope: {
          metricDefinition: "GMV",
          pinnedTables: ["orders"]
        }
      });
      expect(followUp.standaloneQuestion).toContain("context:");
      expect(followUp.standaloneQuestion).toContain("metric=GMV");
      expect(followUp.standaloneQuestion).toContain("tables=orders");
    });

    it("routes complete analytical questions to text_to_sql", () => {
      expect(node.run({ question: "近30天订单总数" })).toMatchObject({
        route: "text_to_sql"
      });
    });
  });

  describe("semantic-plan node", () => {
    const service = new SemanticPlanService(new SemanticPlanValidator());
    const node = new SemanticPlanNode(service);

    it("maps validation outcomes to graph routes", () => {
      expect(
        node.run({
          question: "统计订单总数",
          contextPack: {
            status: "ready",
            selectedEvidenceIds: ["chunk-orders-1"],
            selectedTables: ["orders"],
            selectedColumns: ["orders.id"]
          }
        }).route
      ).toBe("ready");

      expect(
        node.run({
          question: "什么是 GMV 口径？",
          contextPack: {
            status: "ready",
            selectedEvidenceIds: ["metric.gmv"],
            selectedTables: [],
            selectedColumns: []
          }
        }).route
      ).toBe("direct_answer");

      expect(
        node.run({
          question: "统计 GMV",
          contextPack: {
            status: "degraded",
            selectedEvidenceIds: [],
            selectedTables: [],
            selectedColumns: [],
            warnings: ["clarification_round:2", "clarification_max_rounds:2"]
          }
        }).route
      ).toBe("fail_closed");
    });
  });

  describe("assemble-context node", () => {
    const node = new AssembleContextNode(new SemanticContextPackService());

    it("emits rich context-pack fields and typed summary counts without raw snippets", () => {
      const result = node.run({
        retrievalBundle: {
          status: "degraded",
          selected_context: [
            {
              chunk_id: "schema-orders",
              content: "orders schema",
              metadata: {
                tableNames: ["Orders"],
                columnNames: ["Orders.Id"]
              }
            }
          ],
          context_pack: {
            lane_metadata: [
              {
                lane: "dense",
                state: "unavailable",
                unavailable_reason: "provider_missing",
                reason_codes: ["embedding_provider_missing"],
                evidence_ids: ["dense.orders.1"]
              },
              {
                lane: "metric",
                state: "ready",
                evidence_ids: ["metric.gmv"],
                reason_codes: ["metric_binding_selected"]
              }
            ],
            pruning_decisions: [
              {
                budget_source: "context_pack",
                kept_evidence_ids: ["schema-orders"],
                removed_evidence_ids: ["dense.orders.1"],
                reason_codes: ["token_budget_limited"],
                summary: "removed low confidence dense chunk"
              }
            ],
            permission_filtering: {
              status: "applied",
              denied_evidence_ids: ["secret-chunk"],
              denied_table_names: ["secret_orders"],
              denied_column_names: ["secret_orders.internal_note"],
              reason_codes: ["permission_filtered_not_in_allowed_tables"]
            },
            semantic_bindings: {
              model_keys: ["model.orders"],
              metric_keys: ["metric.gmv"]
            }
          },
          degrade_reasons: ["lexical_fallback_used"]
        },
        additionalWarnings: ["context_source_disclosure:retrieval_bundle"]
      });

      expect(result.contextPack.version).toBe("v1.rich");
      expect(result.contextPack.capabilities).toEqual(
        expect.arrayContaining([
          "selected_context_summary",
          "structured_lanes",
          "structured_degradation",
          "structured_pruning",
          "structured_permission_filtering"
        ])
      );
      expect(result.contextPack.selectedContextSummary).toMatchObject({
        count: 1,
        evidenceIds: expect.arrayContaining(["schema-orders"])
      });
      expect(result.contextPack.selectedContextSummary).toEqual(
        expect.not.objectContaining({ snippets: expect.anything() })
      );
      expect(result.contextPack.degradation).toMatchObject({
        status: "degraded",
        reasons: ["lexical_fallback_used"]
      });
      expect(result.contextPack.permissionFiltering).toMatchObject({
        status: "applied",
        deniedEvidenceCount: 1
      });
      expect(result.typedSummary).toMatchObject({
        status: "degraded",
        version: "v1.rich",
        capabilityCount: expect.any(Number),
        selectedEvidenceCount: expect.any(Number),
        degradedLaneCount: 1,
        permissionDeniedEvidenceCount: 1
      });
      expect(result.evidenceRefs).toEqual(
        expect.arrayContaining(["schema-orders", "dense.orders.1", "metric.gmv"])
      );
    });
  });

  describe("generate-sql node", () => {
    it("returns a structured artifact with cause, evidence, used tables and columns", async () => {
      const sqlGenerationService = {
        generate: jest.fn().mockResolvedValue({
          provider: "volcengine",
          model: "mock-model",
          sql: "SELECT orders.id, orders.amount FROM orders",
          explanation: "Use the grounded orders table.",
          rawText: "SELECT orders.id, orders.amount FROM orders",
          prompt: {
            systemPrompt: "system",
            userPrompt: "user"
          },
          promptTemplate: {
            templateId: "tpl-1",
            scene: "sql",
            scope: "global",
            version: 3
          },
          coverage: {
            gateStatus: "passed",
            missingObjects: [],
            triggerSource: "selected_context",
            usedObjects: ["table:orders", "column:orders.id", "column:orders.amount"]
          },
          semanticPlan: readyPlan
        }),
        buildStructuredArtifact: jest.fn().mockReturnValue({
          sql: "SELECT orders.id, orders.amount FROM orders",
          assumptions: ["Use the grounded orders table."],
          usedTables: ["orders"],
          usedColumns: ["orders.id", "orders.amount", "id", "amount"],
          evidenceRefs: ["chunk-orders-1"],
          cause: "initial",
          dialect: "sqlite"
        })
      };
      const node = new GenerateSqlNode(sqlGenerationService as never);

      const result = await node.run({
        question: "统计订单总数",
        datasourceType: "sqlite",
        semanticPlan: readyPlan
      });

      expect(sqlGenerationService.generate).toHaveBeenCalled();
      expect(sqlGenerationService.buildStructuredArtifact).toHaveBeenCalledWith({
        draft: expect.objectContaining({
          sql: "SELECT orders.id, orders.amount FROM orders"
        }),
        datasourceType: "sqlite",
        cause: "initial",
        retryReason: undefined,
        correctionGrounding: undefined
      });
      expect(result.artifact).toMatchObject({
        cause: "initial",
        usedTables: ["orders"],
        evidenceRefs: ["chunk-orders-1"]
      });
    });

    it("passes correction grounding into generation selection and artifact build", async () => {
      const correctionGrounding = {
        failedSqlRef: "sql.sha256.abc123abc123abcd",
        retryReason: "missing column orders.missing_city",
        attemptCount: 1,
        maxAttempts: 2,
        evidenceRefs: ["chunk-orders-1"]
      };
      const sqlGenerationService = {
        generate: jest.fn().mockResolvedValue({
          provider: "volcengine",
          model: "mock-model",
          sql: "SELECT orders.id FROM orders",
          explanation: "retry with corrected column",
          rawText: "SELECT orders.id FROM orders",
          prompt: {
            systemPrompt: "system",
            userPrompt: "user"
          },
          semanticPlan: readyPlan
        }),
        buildStructuredArtifact: jest.fn().mockReturnValue({
          sql: "SELECT orders.id FROM orders",
          usedTables: ["orders"],
          usedColumns: ["orders.id", "id"],
          evidenceRefs: ["chunk-orders-1"],
          cause: "correction",
          dialect: "sqlite",
          correctionGrounding
        })
      };
      const node = new GenerateSqlNode(sqlGenerationService as never);

      await node.run({
        question: "统计订单总数",
        datasourceType: "sqlite",
        semanticPlan: readyPlan,
        cause: "correction",
        retryReason: "missing column orders.missing_city",
        correctionGrounding
      });

      expect(sqlGenerationService.generate).toHaveBeenCalledWith(
        "统计订单总数",
        expect.objectContaining({
          correctionGrounding
        })
      );
      expect(sqlGenerationService.buildStructuredArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: "correction",
          retryReason: "missing column orders.missing_city",
          correctionGrounding
        })
      );
    });

    it("rejects non text-to-sql semantic plans before generation", async () => {
      const node = new GenerateSqlNode({
        generate: jest.fn(),
        stream: jest.fn(),
        buildStructuredArtifact: jest.fn()
      } as never);

      for (const routeKind of ["metadata", "general", "clarify", "fail_closed"]) {
        await expect(
          node.run({
            question: "有哪些表",
            semanticPlan: {
              ...readyPlan,
              route:
                routeKind === "clarify"
                  ? "clarify"
                  : routeKind === "fail_closed"
                    ? "reject"
                    : "answer",
              filters: [`route_kind:${routeKind}`]
            }
          })
        ).rejects.toMatchObject({
          code: "SEMANTIC_PLAN_DIRECT_ANSWER_REQUIRED",
          details: expect.objectContaining({
            routeKind
          })
        });
      }
    });
  });

  describe("validate-sql node", () => {
    const node = new ValidateSqlNode(new SqlValidationService());

    it("emits pass, correctable and terminal outcomes", async () => {
      await expect(
        node.run({
          sql: "SELECT COUNT(*) FROM orders",
          semanticPlan: readyPlan,
          datasourceType: "sqlite"
        })
      ).resolves.toMatchObject({ outcome: "pass" });

      await expect(
        node.run({
          sql: "show tables",
          semanticPlan: readyPlan,
          datasourceType: "sqlite"
        })
      ).resolves.toMatchObject({
        outcome: "correctable",
        artifact: {
          failure: {
            code: "SQL_PARSE_UNSUPPORTED_STATEMENT"
          }
        }
      });

      await expect(
        node.run({
          sql: "DELETE FROM orders",
          semanticPlan: readyPlan,
          datasourceType: "sqlite"
        })
      ).resolves.toMatchObject({
        outcome: "terminal",
        artifact: {
          failure: {
            code: "SQL_READ_ONLY_VIOLATION"
          }
        }
      });
    });
  });

  describe("correct-sql node", () => {
    const node = new CorrectSqlNode(new SqlCorrectionService());

    it("increments correction budget and routes back to generation for correctable failures", () => {
      const result = node.run({
        failedSql: "SELECT missing_city FROM orders",
        attemptCount: 0,
        semanticPlan: readyPlan,
        contextPack: {
          status: "ready",
          selectedEvidenceIds: ["chunk-orders-1"],
          selectedTables: ["orders"],
          selectedColumns: ["orders.id"]
        },
        validationArtifact: {
          status: "failed",
          checks: [],
          correctable: true,
          failure: {
            code: "SQL_MISSING_COLUMN",
            message: "missing column orders.missing_city",
            category: "validation",
            terminal: false,
            correctable: true
          }
        }
      });

      expect(result).toMatchObject({
        outcome: "retry_generation",
        budget: {
          attemptCount: 1,
          maxAttempts: 2,
          remainingAttempts: 1,
          exhausted: false
        },
        artifact: {
          shouldRevalidate: true,
          semanticPlanSnapshotId: readyPlan.snapshotId,
          evidenceRefs: ["chunk-orders-1"],
          grounding: {
            failedSqlRef: expect.stringMatching(/^sql\.sha256\.[0-9a-f]{16}$/),
            retryReason: "missing column orders.missing_city",
            failureCode: "SQL_MISSING_COLUMN",
            failureCategory: "validation",
            source: "validation",
            attemptCount: 1,
            maxAttempts: 2,
            semanticPlanSnapshotId: readyPlan.snapshotId,
            contextPackStatus: "ready",
            contextPackEvidenceCount: 1
          }
        }
      });
    });

    it("keeps governance and exhausted retries terminal", () => {
      expect(
        node.run({
          failedSql: "DELETE FROM orders",
          attemptCount: 0,
          validationArtifact: {
            status: "failed",
            checks: [],
            correctable: false,
            failure: {
              code: "SQL_READ_ONLY_VIOLATION",
              message: "read-only violation",
              category: "governance",
              terminal: true,
              correctable: false
            }
          }
        })
      ).toMatchObject({
        outcome: "terminal",
        failure: {
          code: "SQL_READ_ONLY_VIOLATION",
          category: "governance",
          terminal: true
        }
      });

      expect(
        node.run({
          failedSql: "SELECT missing_city FROM orders",
          attemptCount: 1,
          validationArtifact: {
            status: "failed",
            checks: [],
            correctable: true,
            failure: {
              code: "SQL_MISSING_COLUMN",
              message: "missing column orders.missing_city",
              category: "validation",
              terminal: false,
              correctable: true
            }
          }
        })
      ).toMatchObject({
        outcome: "terminal",
        failure: {
          code: "SQL_CORRECTION_BUDGET_EXHAUSTED",
          terminal: true
        }
      });
    });
  });

  describe("execute-sql node", () => {
    it("requires passed validation before execution", async () => {
      const node = new ExecuteSqlNode({
        run: jest.fn()
      } as never);

      await expect(
        node.run({
          sql: "SELECT 1",
          validationArtifact: {
            status: "failed",
            checks: [],
            correctable: false,
            failure: {
              code: "SQL_READ_ONLY_VIOLATION",
              message: "blocked",
              category: "governance",
              terminal: true,
              correctable: false
            }
          },
          datasourceId: "ds-1",
          sessionId: "session-1"
        })
      ).rejects.toMatchObject({
        code: "SQL_EXECUTE_PRECONDITION_FAILED"
      });
    });

    it("delegates execution and returns row-count metadata after pass", async () => {
      const legacyNode = {
        run: jest.fn().mockResolvedValue({
          rows: [{ total: 3 }],
          columns: ["total"]
        })
      };
      const node = new ExecuteSqlNode(legacyNode as never);

      await expect(
        node.run({
          sqlArtifact: {
            sql: "SELECT COUNT(*) AS total FROM orders",
            usedTables: ["orders"],
            usedColumns: ["total"],
            evidenceRefs: ["chunk-orders-1"],
            cause: "initial",
            dialect: "sqlite",
            claimedObligationIds: ["ledger:table:orders"]
          },
          validationArtifact: {
            status: "passed",
            checks: [],
            correctable: false
          },
          datasourceId: "ds-1",
          sessionId: "session-1",
          semanticPlan: readyPlan
        })
      ).resolves.toMatchObject({
        rowCount: 1,
        emptyResult: false,
        columns: ["total"]
      });
      expect(legacyNode.run).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: "SELECT COUNT(*) AS total FROM orders",
          sqlArtifact: expect.objectContaining({
            claimedObligationIds: ["ledger:table:orders"]
          })
        })
      );
    });
  });

  describe("answer node", () => {
    const node = new AnswerNode(new FormatAnswerNode());

    it("unifies execution success, direct-answer and fail-closed terminals", () => {
      expect(
        node.run({
          question: "统计订单总数",
          executionResult: {
            rows: [{ total: 3 }],
            columns: ["total"],
            rowCount: 1,
            emptyResult: false
          },
          sqlArtifact: {
            sql: "SELECT COUNT(*) AS total FROM orders",
            usedTables: ["orders"],
            usedColumns: ["total"],
            evidenceRefs: ["chunk-orders-1"],
            cause: "initial",
            dialect: "sqlite"
          }
        })
      ).toMatchObject({
        mode: "execution_result",
        status: "executionResult",
        evidenceRefs: ["chunk-orders-1"]
      });

      expect(
        node.run({
          question: "什么是 GMV 口径？",
          directAnswer: "这是通用说明问题，不需要执行 SQL；我会基于已有语义证据直接解释。"
        })
      ).toMatchObject({
        mode: "direct_answer",
        status: "executionResult"
      });

      expect(
        node.run({
          question: "DELETE FROM orders",
          failure: {
            code: "SQL_READ_ONLY_VIOLATION",
            message: "检测到写操作或 DDL，已阻止执行",
            category: "governance",
            terminal: true,
            correctable: false
          }
        })
      ).toMatchObject({
        mode: "fail_closed",
          status: "rejected"
        });
    });

    it("does not label provider generation failures as governance fail-closed", () => {
      const result = node.run({
        question: "有多少种支付方式，他们比例是如何",
        failure: {
          code: "LLM_REQUEST_FAILED",
          message: "LLM 请求失败: The operation was aborted due to timeout",
          category: "generation",
          terminal: true,
          correctable: false
        }
      });

      expect(result).toMatchObject({
        mode: "execution_failure",
        status: "failed"
      });
      expect(result.answer).toContain("SQL 生成或服务调用阶段");
      expect(result.answer).not.toContain("安全或治理校验");
    });

    it("builds evidence-grounded metadata direct answers and keeps general direct answers lightweight", () => {
      const metadataAnswer = node.run({
        question: "有哪些表",
        directAnswer:
          "这是元数据问题，我会基于可访问的表结构与语义证据直接说明，不执行 SQL。",
        semanticPlan: {
          ...readyPlan,
          filters: ["route_kind:metadata"],
          selectedTables: ["orders"],
          selectedColumns: ["orders.id", "orders.amount"],
          evidenceRefs: ["schema-orders", "metric-gmv"]
        },
        contextPack: {
          status: "degraded",
          selectedEvidenceIds: ["schema-orders", "metric-gmv"],
          selectedTables: ["orders"],
          selectedColumns: ["orders.id", "orders.amount"],
          selectedContextSummary: {
            count: 2,
            evidenceIds: ["schema-orders", "metric-gmv"],
            laneNames: ["schema", "metric"]
          },
          lanes: {
            schemaSupplementRefs: {
              refs: ["schema-supplement-1"],
              count: 1
            }
          },
          pruning: {
            applied: true,
            decisions: [
              {
                keptCount: 2,
                removedCount: 1,
                reasonCodes: ["token_budget_limited"]
              }
            ]
          },
          permissionFiltering: {
            status: "applied",
            deniedEvidenceCount: 1,
            deniedEvidenceIds: ["secret-chunk"],
            deniedTables: ["secret_orders"],
            reasonCodes: ["permission_filtered_not_in_allowed_tables"]
          },
          degradation: {
            status: "degraded",
            reasons: ["lexical_fallback_used"]
          },
          laneStates: [
            {
              lane: "dense",
              state: "unavailable",
              reasonCodes: ["embedding_provider_missing"]
            }
          ],
          warnings: ["dense_unavailable:embedding_provider_missing"]
        }
      });

      expect(metadataAnswer).toMatchObject({
        mode: "direct_answer",
        status: "executionResult",
        evidenceRefs: expect.arrayContaining(["schema-orders", "metric-gmv"])
      });
      expect(metadataAnswer.answer).toContain("元数据证据摘要：已选中 2 条上下文证据。");
      expect(metadataAnswer.answer).toContain("裁剪情况：已触发");
      expect(metadataAnswer.answer).toContain("权限过滤：已应用");
      expect(metadataAnswer.answer).toContain("证据质量：degraded");
      expect(metadataAnswer.answer).not.toContain("secret_orders");

      const generalAnswer = node.run({
        question: "什么是 GMV 口径？",
        directAnswer: "这是通用说明问题，不需要执行 SQL；我会基于已有语义证据直接解释。",
        semanticPlan: {
          ...readyPlan,
          filters: ["route_kind:general"]
        }
      });
      expect(generalAnswer.answer).not.toContain("元数据证据摘要");
    });
  });
});
