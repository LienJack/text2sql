import { Injectable } from "@nestjs/common";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";
import yaml from "js-yaml";
import type {
  EvaluationCase,
  EvaluationCaseResult,
  EvaluationReport
} from "@text2sql/shared-types";
import { GraphBuilderService } from "../conversation/agent/graph/graph.builder";
import { ChatRepository } from "../data/persistence/chat.repository";
import { AppConfigService } from "../config/app-config.service";

@Injectable()
export class EvalService {
  constructor(
    private readonly graphBuilder: GraphBuilderService,
    private readonly repository: ChatRepository,
    private readonly appConfig: AppConfigService
  ) {}

  async run(caseFilePath?: string, requestId?: string): Promise<EvaluationReport> {
    const cases = await this.loadCases(caseFilePath);
    const results: EvaluationCaseResult[] = [];
    const jobId = uuidv4();
    for (const item of cases) {
      const evalSessionId = `eval-${jobId}-${item.id}`;
      await this.repository.createSession({
        id: evalSessionId,
        datasource: "sqlite_main",
        createdAt: new Date().toISOString()
      });
      const run = await this.graphBuilder.run({
        runId: uuidv4(),
        sessionId: evalSessionId,
        question: item.question,
        datasourceId: "sqlite_main",
        datasourceType: "sqlite",
        traceContext: {
          source: "evaluation",
          route: "/api/v1/evaluations/run",
          requestId,
          jobId,
          caseId: item.id
        }
      });

      let passed = true;
      let reason = "";
      if (item.expectedStatus && run.status !== item.expectedStatus) {
        passed = false;
        reason = `状态不匹配，期望 ${item.expectedStatus}，实际 ${run.status}`;
      }
      if (
        passed &&
        item.mustIncludeSql &&
        item.mustIncludeSql.length > 0 &&
        (!run.sql ||
          !item.mustIncludeSql.every((keyword) =>
            run.sql?.toLowerCase().includes(keyword.toLowerCase())
          ))
      ) {
        passed = false;
        reason = `SQL 未包含期望关键字: ${item.mustIncludeSql.join(", ")}`;
      }
      results.push({
        id: item.id,
        passed,
        reason: passed ? undefined : reason,
        run
      });
    }
    const passedCount = results.filter((item) => item.passed).length;
    const report: EvaluationReport = {
      jobId,
      provider: this.appConfig.llmProvider,
      total: results.length,
      passed: passedCount,
      passRate: results.length ? Number((passedCount / results.length).toFixed(4)) : 0,
      createdAt: new Date().toISOString(),
      cases: results
    };
    await this.repository.persistEvaluationReport(report);
    return report;
  }

  async getReport(jobId: string): Promise<EvaluationReport | undefined> {
    return this.repository.getEvaluationReport(jobId);
  }

  private async loadCases(caseFilePath?: string): Promise<EvaluationCase[]> {
    const target = await this.resolveCasePath(caseFilePath);
    const fileContent = await readFile(target, "utf8");
    const parsed = yaml.load(fileContent) as { cases?: EvaluationCase[] };
    return parsed?.cases ?? [];
  }

  private async resolveCasePath(caseFilePath?: string): Promise<string> {
    if (caseFilePath) {
      return resolve(caseFilePath);
    }
    const candidates = [
      resolve(process.cwd(), "vibe/plain/eval/stage2-quality-cases.yaml"),
      resolve(process.cwd(), "../../vibe/plain/eval/stage2-quality-cases.yaml")
    ];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // continue
      }
    }
    throw new Error("未找到 stage2-quality-cases.yaml 评测文件。");
  }
}
