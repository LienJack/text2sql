import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { EvalService } from "../../src/modules/eval/eval.service";

describe("evaluation report", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.LLM_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
  });

  it("should generate an evaluation report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "text2sql-eval-"));
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
    const service = moduleRef.get(EvalService);
    const report = await service.run(filePath);
    expect(report.total).toBe(1);
    expect(report.jobId).toBeDefined();
  });
});
