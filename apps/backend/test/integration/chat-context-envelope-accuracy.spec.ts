import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { ChatService } from "../../src/modules/conversation/chat/chat.service";
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

    const chatService = moduleRef.get(ChatService);
    const enrichment = moduleRef.get(ChatDeliveryEnrichmentService);

    const businessSession = await chatService.createSession("sqlite_main");
    const businessRun = await chatService.sendMessage(
      businessSession.id,
      "统计近30天订单总数",
      undefined,
      {
        metricDefinition: "订单总数",
        timeRange: {
          from: "2026-03-01",
          to: "2026-03-31"
        }
      }
    );
    const businessWithDelivery = await enrichment.attachDeliveryContract(businessRun);
    expect(businessRun.status).not.toBe("clarification");
    if (businessRun.sql) {
      expect(businessRun.sql.toLowerCase()).toContain("count(");
    } else {
      expect(businessRun.status).toBe("failed");
      expect(businessRun.error ?? "").toMatch(/语义计划|SQL 超出|校验失败/);
    }
    expect(businessRun.trace.v2?.version).toBe("v2");
    expect(businessWithDelivery.delivery?.evidence?.v2?.version).toBe("v2");
    expect(businessWithDelivery.delivery?.evidence?.v2?.stageOrder).toEqual(
      businessRun.trace.v2?.stageOrder
    );

    const metadataSession = await chatService.createSession("sqlite_main");
    const metadataRun = await chatService.sendMessage(
      metadataSession.id,
      "数据库有哪些表"
    );
    expect(metadataRun.status).not.toBe("clarification");
    expect(metadataRun.trace.steps.map((step) => step.node)).toEqual(["intake", "answer"]);
    const metadataIntakeStage = metadataRun.trace.v2?.stages.find(
      (stage) => stage.stage === "intake"
    );
    expect(metadataIntakeStage?.metadata?.route).toBe("metadata");
    expect((metadataRun.answer ?? "").trim().length).toBeGreaterThan(0);

    const clarifySession = await chatService.createSession("sqlite_main");
    const clarifyRun = await chatService.sendMessage(clarifySession.id, "退款");
    expect(clarifyRun.status).toBe("clarification");
    expect(clarifyRun.clarification?.question).toBeTruthy();
    expect(clarifyRun.trace.v2?.terminationReason).toBe("clarification_requested");

    const conflictSession = await chatService.createSession("sqlite_main");
    const conflictRun = await chatService.sendMessage(
      conflictSession.id,
      "统计订单总数",
      undefined,
      {
        metricDefinition: "订单总数",
        mustIncludeTables: ["orders"],
        mustExcludeTables: ["orders"]
      }
    );
    const conflictWithDelivery = await enrichment.attachDeliveryContract(conflictRun);

    expect(conflictRun.trace.v2?.version).toBe("v2");
    expect(conflictWithDelivery.delivery?.evidence?.v2?.stageOrder).toEqual(
      conflictRun.trace.v2?.stageOrder
    );
    expect(conflictRun.trace.conflictHint).toBeUndefined();
    expect(conflictWithDelivery.delivery?.evidence?.conflictHint).toBeUndefined();

    const pinnedSession = await chatService.createSession("sqlite_main");
    const pinnedContextRun = await chatService.sendMessage(
      pinnedSession.id,
      "数据库有哪些表",
      undefined,
      {
        pinnedTables: ["orders"],
        pinnedColumns: ["amount"]
      }
    );
    expect(pinnedContextRun.trace.effectiveContextSummary).toBeUndefined();
    expect(pinnedContextRun.delivery?.evidence?.effectiveContextSummary).toBeUndefined();
    expect(pinnedContextRun.trace.steps.map((step) => step.node)).toEqual(["intake", "answer"]);

    await moduleRef.close();
  });
});
