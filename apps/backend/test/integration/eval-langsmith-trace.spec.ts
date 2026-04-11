import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { EvalService } from "../../src/modules/eval/eval.service";
import { LangsmithTraceService } from "../../src/modules/observability/langsmith-trace.service";

describe("eval langsmith trace", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.LLM_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LANGSMITH_TRACING = "false";
    process.env.LANGSMITH_API_KEY = "";
  });

  it("should pass evaluation context into langsmith tracing hooks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "text2sql-langsmith-eval-"));
    const filePath = join(dir, "cases.yaml");
    await writeFile(
      filePath,
      [
        "cases:",
        "  - id: c1",
        "    question: \"统计订单状态\"",
        "    expectedStatus: executionResult",
        "    mustIncludeSql:",
        "      - orders"
      ].join("\n"),
      "utf8"
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const evalService = moduleRef.get(EvalService);
    const langsmith = moduleRef.get(LangsmithTraceService);
    const startSpy = jest.spyOn(langsmith, "startRoot");
    const endSpy = jest.spyOn(langsmith, "endRoot");

    const report = await evalService.run(filePath, "req-eval-1");
    expect(report.total).toBe(1);
    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "evaluation",
        route: "/api/v1/evaluations/run",
        requestId: "req-eval-1",
        caseId: "c1"
      })
    );
    expect(endSpy).toHaveBeenCalled();
  });
});
