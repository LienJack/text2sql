import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RetrieveKnowledgeNode } from "../../src/modules/conversation/agent/nodes/retrieve-knowledge.node";
import { ChatService } from "../../src/modules/conversation/chat/chat.service";
import { RagRerankService } from "../../src/modules/knowledge/rag/rerank/rag-rerank.service";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";

describe("agent rag degrade flow integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_MOCK_MODE = "true";
    process.env.EMBEDDING_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.AGENT_PLANNING_SCAFFOLD_ENABLED = "true";
  });

  it("keeps main flow available when retrieval degrades due to missing active index", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const chatService = moduleRef.get(ChatService);
    const session = await chatService.createSession("sqlite_main");
    const run = await chatService.sendMessage(session.id, "按状态统计订单数量");

    const retrieveStep = run.trace.steps.find((step) => step.node === "retrieve-context");
    expect(retrieveStep).toBeDefined();
    expect(retrieveStep?.outputSummary ?? "").toMatch(/degrad|降级|retrievalStatus/i);

    const generateStep = run.trace.steps.find((step) => step.node === "generate-sql");
    expect(generateStep?.status).toBe("success");

    expect(["executionResult", "failed", "rejected"]).toContain(run.status);

    await moduleRef.close();
  });

  it("keeps SQL path when RAG retrieval is disabled and grounding evidence is absent", async () => {
    const previousRetrievalEnabled = process.env.AGENT_RAG_RETRIEVAL_ENABLED;
    process.env.AGENT_RAG_RETRIEVAL_ENABLED = "false";

    try {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule]
      }).compile();
      const chatService = moduleRef.get(ChatService);
      const session = await chatService.createSession("sqlite_main");
      const run = await chatService.sendMessage(session.id, "按状态统计订单数量");

      const generateStep = run.trace.steps.find((step) => step.node === "generate-sql");
      expect(generateStep).toBeDefined();
      expect(generateStep?.status).toBe("success");

      expect(run.trace.v2?.semanticPlan?.route).toBe("answer");
      expect(run.status).not.toBe("clarification");

      await moduleRef.close();
    } finally {
      if (previousRetrievalEnabled === undefined) {
        delete process.env.AGENT_RAG_RETRIEVAL_ENABLED;
      } else {
        process.env.AGENT_RAG_RETRIEVAL_ENABLED = previousRetrievalEnabled;
      }
    }
  });

  it("marks dense/rerank unavailable explicitly when external providers are not configured", async () => {
    process.env.NODE_ENV = "development";
    process.env.LLM_MOCK_MODE = "false";
    process.env.EMBEDDING_MOCK_MODE = "false";
    process.env.RERANK_MOCK_MODE = "false";
    process.env.LLM_API_KEY = "";
    process.env.LLM_BASE_URL = "";
    process.env.EMBEDDING_API_KEY = "";
    process.env.EMBEDDING_BASE_URL = "";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const retrieveKnowledgeNode = moduleRef.get(RetrieveKnowledgeNode);
    const rerankService = moduleRef.get(RagRerankService);
    const repository = moduleRef.get(RagIndexRepository);
    const builder = moduleRef.get(RagIndexBuilderService);

    repository.seedChunksForDatasource("sqlite_main", [
      {
        id: "chunk-agent-rag-degrade-schema",
        datasourceId: "sqlite_main",
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status"]
        })
      },
      {
        id: "chunk-agent-rag-degrade-example",
        datasourceId: "sqlite_main",
        domain: "sql_example",
        content: "SELECT status, SUM(amount) FROM orders GROUP BY status",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["status", "amount"]
        })
      },
      {
        id: "chunk-agent-rag-degrade-semantic",
        datasourceId: "sqlite_main",
        domain: "semantic_term",
        content: "GMV maps to total order amount.",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["amount"]
        })
      }
    ]);
    await builder.buildAndActivate({
      datasourceId: "sqlite_main",
      sourceVersion: "source-agent-rag-degrade-v2",
      createdByRunId: "run-agent-rag-degrade-build-v2",
      activatedByRunId: "run-agent-rag-degrade-build-v2"
    });

    const knowledge = await retrieveKnowledgeNode.run({
      question: "统计订单金额",
      datasourceId: "sqlite_main",
      runId: "run-agent-rag-degrade-retrieve-v2"
    });

    expect(knowledge.status).toBe("degraded");
    expect(knowledge.retrievalBundle?.lane_results.dense.degrade_reason ?? "").toContain(
      "dense_unavailable"
    );
    expect(knowledge.summary).toContain("dense=unavailable");
    expect(knowledge.summary).toContain("rerank=");

    const explicitRerank = await rerankService.rerank({
      retrievalBundle: knowledge.retrievalBundle!,
      secondaryMinCandidates: 1,
      secondaryTopK: 3,
      selectedContextLimit: 3
    });
    expect(
      explicitRerank.retrieval_bundle.rerank_metadata?.secondary.unavailable_reason ??
        explicitRerank.retrieval_bundle.rerankMetadata?.secondary.unavailableReason ??
        ""
    ).toContain("secondary_rerank_unavailable");

    await moduleRef.close();
  });
});
