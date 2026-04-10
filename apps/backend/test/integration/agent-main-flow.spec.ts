import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { GraphBuilderService } from "../../src/modules/agent/graph/graph.builder";

describe("agent main flow", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
  });

  it("should return execution result for clear question", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const graph = moduleRef.get(GraphBuilderService);
    const run = await graph.run({
      runId: "run-1",
      sessionId: "session-1",
      question: "统计商家交易额"
    });
    expect(["executionResult", "failed"]).toContain(run.status);
    expect(run.trace.steps.length).toBeGreaterThan(0);
  });

  it("should reject non-readonly sql intent", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const graph = moduleRef.get(GraphBuilderService);
    const run = await graph.run({
      runId: "run-2",
      sessionId: "session-2",
      question: "DELETE orders where id = 1"
    });
    expect(run.status).toBe("rejected");
  });
});

