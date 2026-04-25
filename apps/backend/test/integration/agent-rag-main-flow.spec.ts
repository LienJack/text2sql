import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { GraphBuilderService } from "../../src/modules/conversation/agent/graph/graph.builder";
import { BuildIntentPlanNode } from "../../src/modules/conversation/agent/nodes/build-intent-plan.node";
import { RetrieveKnowledgeNode } from "../../src/modules/conversation/agent/nodes/retrieve-knowledge.node";
import { RagEventConsumerService } from "../../src/modules/rag/events/rag-event-consumer.service";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";

describe("agent rag main flow integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.AGENT_PLANNING_SCAFFOLD_ENABLED = "true";
  });

  it("runs retrieve -> rerank pipeline and passes selected_context to SQL generation", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const graph = moduleRef.get(GraphBuilderService);
    const buildIntentPlanNode = moduleRef.get(BuildIntentPlanNode);
    const retrieveKnowledgeNode = moduleRef.get(RetrieveKnowledgeNode);
    const repository = moduleRef.get(RagIndexRepository);
    const builder = moduleRef.get(RagIndexBuilderService);
    const eventConsumer = moduleRef.get(RagEventConsumerService);

    repository.seedChunksForDatasource("sqlite_main", [
      {
        id: "chunk-agent-rag-schema",
        datasourceId: "sqlite_main",
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status"]
        })
      },
      {
        id: "chunk-agent-rag-sql",
        datasourceId: "sqlite_main",
        domain: "sql_example",
        content: "SELECT status, SUM(amount) FROM orders GROUP BY status"
      },
      {
        id: "chunk-agent-rag-semantic",
        datasourceId: "sqlite_main",
        domain: "semantic_term",
        content: "GMV maps to total order amount."
      }
    ]);
    await builder.buildAndActivate({
      datasourceId: "sqlite_main",
      sourceVersion: "source-agent-rag-main-v1",
      createdByRunId: "run-agent-rag-main-build-v1",
      activatedByRunId: "run-agent-rag-main-build-v1"
    });

    const run = await graph.run({
      runId: "run-agent-rag-main-v1",
      sessionId: "session-agent-rag-main-v1",
      question: "统计订单 GMV",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      planningScaffoldEnabled: true
    });

    const stepNames = run.trace.steps.map((step) => step.node);
    expect(stepNames).toEqual(
      expect.arrayContaining([
        "retrieve-knowledge",
        "build-intent-plan",
        "build-semantic-query",
        "generate-sql",
        "safety-check"
      ])
    );

    const generateStep = run.trace.steps.find((step) => step.node === "generate-sql");
    expect(generateStep?.inputSummary).toContain("selectedContextCount");

    const safetyStep = run.trace.steps.find((step) => step.node === "safety-check");
    expect(safetyStep?.outputSummary).toContain("riskTags");
    expect(run.trace.clarificationDecision).toBeDefined();

    const unpinnedKnowledge = await retrieveKnowledgeNode.run({
      question: "统计订单 GMV",
      datasourceId: "sqlite_main",
      runId: "run-agent-rag-main-retrieve-unpinned"
    });
    const pinnedKnowledge = await retrieveKnowledgeNode.run({
      question: "统计订单 GMV",
      datasourceId: "sqlite_main",
      runId: "run-agent-rag-main-retrieve-pinned",
      pinnedTables: ["refunds"],
      pinnedColumns: ["refund_amount"]
    });
    expect(unpinnedKnowledge.pinning?.status).toBe("inactive");
    expect(pinnedKnowledge.pinning?.enabled).toBe(true);
    expect(pinnedKnowledge.pinning?.status).toBe("applied");
    expect(pinnedKnowledge.summary).toContain("pinning[candidates=");
    expect(
      (pinnedKnowledge.retrievalBundle?.selected_context?.length ?? 0) <=
        (unpinnedKnowledge.retrievalBundle?.selected_context?.length ?? 0)
    ).toBe(true);
    expect(
      pinnedKnowledge.retrievalBundle?.candidates.every((candidate) =>
        candidate.chunk.metadata.tableNames
          .map((tableName) => tableName.toLowerCase())
          .includes("refunds")
      ) ?? true
    ).toBe(true);
    const pinnedIntentPlan = await buildIntentPlanNode.run(
      "统计订单 GMV",
      pinnedKnowledge
    );
    expect(pinnedIntentPlan.constraints).toEqual(
      expect.arrayContaining(["require_pinned_table_alignment"])
    );

    await eventConsumer.consumeEvent({
      eventId: "evt-agent-rag-main-linkage-degraded-1",
      datasourceId: "sqlite_main",
      sourceVersion: "source-agent-rag-main-v2",
      eventType: "semantic_promoted",
      runId: "run-agent-rag-main-linkage-degraded-build-v2",
      payload: {
        linkageStatus: "degraded",
        degradeReason: "semantic_promoted_linkage_degraded",
        glossaryTerms: [
          {
            id: "gterm-agent-main-1",
            term: "GMV",
            definition: "GMV means gross merchandise volume",
            scope: "datasource",
            datasourceId: "sqlite_main",
            priority: 90,
            updatedAt: "2026-04-18T02:30:00.000Z"
          }
        ]
      }
    });

    const degradedRun = await graph.run({
      runId: "run-agent-rag-main-v2",
      sessionId: "session-agent-rag-main-v2",
      question: "统计订单 GMV",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      planningScaffoldEnabled: true
    });

    const degradedRetrieveStep = degradedRun.trace.steps.find(
      (step) => step.node === "retrieve-knowledge"
    );
    const degradedGenerateStep = degradedRun.trace.steps.find(
      (step) => step.node === "generate-sql"
    );

    expect(degradedRetrieveStep?.outputSummary).toContain("semantic_promoted_linkage_degraded");
    expect(degradedGenerateStep?.inputSummary).toContain("retrievalDegradeReasons");
    expect(degradedGenerateStep).toBeDefined();

    await moduleRef.close();
  });
});
