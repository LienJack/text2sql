import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Text2SqlV2EvaluationService,
  type Text2SqlV2EvalCase
} from "../src/modules/conversation/agent/v2/text2sql-v2-evaluation.service";

function main(): void {
  const fixturePath = resolve(
    __dirname,
    "../test/fixtures/text2sql-v2-eval-cases.json"
  );
  const raw = readFileSync(fixturePath, "utf-8");
  const cases = JSON.parse(raw) as Text2SqlV2EvalCase[];
  const service = new Text2SqlV2EvaluationService();
  const summary = service.summarize(cases);

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        fixturePath,
        summary
      },
      null,
      2
    )}\n`
  );
}

main();
