import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { GraphBuilderService } from "../../src/modules/conversation/agent/graph/graph.builder";
import { ChatDeliveryEnrichmentService } from "../../src/modules/conversation/chat/application/shared/chat-delivery-enrichment.service";

describe("chat context envelope accuracy integration", () => {
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

  it("covers business query, metadata query, and conflict context paths", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const graphBuilder = moduleRef.get(GraphBuilderService);
    const enrichment = moduleRef.get(ChatDeliveryEnrichmentService);

    const businessRun = await graphBuilder.run({
      runId: "run-context-accuracy-business",
      sessionId: "session-context-accuracy-business",
      question: "统计近30天订单总数",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      contextEnvelope: {
        metricDefinition: "订单总数",
        timeRange: {
          from: "2026-03-01",
          to: "2026-03-31"
        }
      },
      planningScaffoldEnabled: true
    });
    const businessWithDelivery = await enrichment.attachDeliveryContract(businessRun);
    expect(businessRun.status).not.toBe("clarification");
    expect(businessRun.sql?.toLowerCase()).toContain("count(");
    expect(
      businessRun.trace.effectiveContextSummary?.userEnvelope.metricDefinitionProvided
    ).toBe(true);
    expect(
      businessWithDelivery.delivery?.evidence?.effectiveContextSummary?.sourcePriority
    ).toBe("user_explicit_over_system");

    const metadataRun = await graphBuilder.run({
      runId: "run-context-accuracy-metadata",
      sessionId: "session-context-accuracy-metadata",
      question: "数据库有哪些表",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      planningScaffoldEnabled: true
    });
    const metadataClarifyStep = metadataRun.trace.steps.find(
      (step) => step.node === "clarify"
    );
    expect(metadataRun.status).not.toBe("clarification");
    expect(metadataRun.sql?.toLowerCase()).toContain("sqlite_master");
    expect(metadataClarifyStep?.status).toBe("skipped");

    const clarifyRun = await graphBuilder.run({
      runId: "run-context-accuracy-clarify",
      sessionId: "session-context-accuracy-clarify",
      question: "退款",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      planningScaffoldEnabled: true
    });
    expect(clarifyRun.status).toBe("clarification");
    expect(clarifyRun.clarification?.question).toBeTruthy();

    const conflictRun = await graphBuilder.run({
      runId: "run-context-accuracy-conflict",
      sessionId: "session-context-accuracy-conflict",
      question: "统计订单总数",
      datasourceId: "sqlite_main",
      datasourceType: "sqlite",
      contextEnvelope: {
        metricDefinition: "订单总数",
        mustIncludeTables: ["orders"],
        mustExcludeTables: ["orders"]
      },
      planningScaffoldEnabled: true
    });
    const conflictWithDelivery = await enrichment.attachDeliveryContract(conflictRun);

    expect(conflictRun.trace.conflictHint?.hasConflict).toBe(true);
    expect(conflictWithDelivery.delivery?.evidence?.conflictHint?.hasConflict).toBe(
      true
    );
    expect(conflictWithDelivery.delivery?.evidence?.riskTags).toEqual(
      expect.arrayContaining(["context_conflict_detected"])
    );

    await moduleRef.close();
  });
});
