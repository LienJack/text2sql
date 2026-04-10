import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { GraphBuilderService } from "../../src/modules/agent/graph/graph.builder";

interface StageCase {
  id: string;
  question: string;
}

describe("stage1 acceptance", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.LLM_MOCK_MODE = "true";
    process.env.LLM_PROVIDER = "volcengine";
  });

  it("should pass all 12 stage1 cases", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const graph = moduleRef.get(GraphBuilderService);

    const filePath = await resolveStageCasePath();
    const raw = await readFile(filePath, "utf8");
    const parsed = yaml.load(raw) as { cases: StageCase[] };

    let passed = 0;
    let clarificationCount = 0;
    for (const item of parsed.cases) {
      const run = await graph.run({
        runId: `stage1-${item.id}`,
        sessionId: "stage1",
        question: item.question
      });
      if (
        run.status === "executionResult" ||
        run.status === "clarification" ||
        run.status === "rejected"
      ) {
        passed += 1;
      }
      if (run.status === "clarification") {
        clarificationCount += 1;
      }
    }

    expect(parsed.cases.length).toBe(12);
    expect(passed).toBe(12);
    expect(clarificationCount).toBeGreaterThanOrEqual(2);
  });
});

async function resolveStageCasePath(): Promise<string> {
  const candidates = [
    resolve(process.cwd(), "vibe/plain/eval/stage1-12-cases.yaml"),
    resolve(process.cwd(), "../../vibe/plain/eval/stage1-12-cases.yaml")
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  throw new Error("未找到 stage1-12-cases.yaml");
}
