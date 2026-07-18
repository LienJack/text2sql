import { Injectable } from "@nestjs/common";
import type {
  AnalysisGoalContract,
  AnalysisTaskRevisionRecord
} from "@text2sql/analysis-task-protocol";
import { sha256Digest, stableJson } from "../../../platform/data/persistence/analysis-ledger.util";
import type {
  AnalysisProofObligation,
  AnalysisWorkGraph,
  AnalysisWorkItem,
  AnalysisWorkKind
} from "./work-graph.types";

@Injectable()
export class AnalysisGoalCompilerService {
  compile(input: {
    taskId: string;
    revision: AnalysisTaskRevisionRecord;
    multiWorkerMode?: "off" | "shadow";
    compiledAt?: string;
  }): AnalysisWorkGraph {
    const goal = input.revision.goalContract;
    const obligations = this.buildObligations(goal);
    const workItems = this.buildWorkItems(goal, obligations);
    const supportedKinds = this.uniqueKinds(
      workItems.filter((item) => item.supported).map((item) => item.kind)
    );
    const deferredKinds = this.uniqueKinds(
      workItems.filter((item) => !item.supported).map((item) => item.kind)
    );
    const unsigned = {
      version: "analysis-work-graph.v1" as const,
      taskId: input.taskId,
      revisionId: input.revision.id,
      goalDigest: input.revision.goalDigest,
      budget: goal.budget,
      stopConditions: [...goal.stopConditions],
      obligations,
      workItems,
      supportedKinds,
      deferredKinds,
      multiWorkerMode: input.multiWorkerMode ?? "off",
      compiledAt: input.compiledAt ?? input.revision.createdAt
    };
    return {
      ...unsigned,
      graphDigest: sha256Digest(stableJson(unsigned))
    };
  }

  private buildObligations(goal: AnalysisGoalContract): AnalysisProofObligation[] {
    const webAllowed = goal.allowedSourceKinds.includes("web");
    return [
      obligation("metric", "metric_definition", "冻结指标口径、时间边界和单位。"),
      obligation("internal", "internal_data_evidence", "用授权数据源验证内部事实。"),
      obligation("segment", "segment_explanation", "解释关键分段和贡献变化。"),
      obligation(
        "external",
        "external_context",
        "检索并冻结外部事件来源。",
        webAllowed,
        webAllowed ? [] : ["web_source_not_allowed"]
      ),
      obligation("alignment", "source_alignment", "对齐跨源时间、实体、单位和粒度。"),
      obligation("calculation", "deterministic_calculation", "确定性重算贡献和差异。"),
      obligation("counter", "counter_evidence", "寻找反证、冲突和替代解释。"),
      obligation("report", "supported_report", "生成逐 Claim 可追溯的报告。")
    ];
  }

  private buildWorkItems(
    goal: AnalysisGoalContract,
    obligations: AnalysisProofObligation[]
  ): AnalysisWorkItem[] {
    const items: AnalysisWorkItem[] = [];
    goal.datasourceIds.forEach((datasourceId, index) => {
      items.push({
        id: `sql:${index + 1}:${datasourceId}`,
        kind: "text2sql",
        workerId: "text2sql.v1",
        description: `${goal.objective}；输出指标、分段与可验证 SQL 结果。`,
        obligationIds: ["metric", "internal", "segment"],
        dependencies: [],
        datasourceId,
        mandatory: true,
        supported: true,
        status: "pending",
        reasonCodes: []
      });
    });
    const sqlIds = items.map((item) => item.id);
    const webAllowed = goal.allowedSourceKinds.includes("web");
    items.push(
      {
        id: "research:external",
        kind: "research",
        workerId: "research.v1",
        description: "检索外部事件并冻结来源快照。",
        obligationIds: ["external"],
        dependencies: [],
        mandatory: webAllowed,
        supported: webAllowed,
        status: webAllowed ? "pending" : "deferred",
        reasonCodes: webAllowed ? [] : ["web_source_not_allowed"]
      },
      {
        id: "align:evidence",
        kind: "evidence_alignment",
        workerId: "evidence-alignment.v1",
        description: "对齐内部与外部证据。",
        obligationIds: ["alignment"],
        dependencies: [...sqlIds, ...(webAllowed ? ["research:external"] : [])],
        mandatory: true,
        supported: true,
        status: "pending",
        reasonCodes: []
      },
      {
        id: "calculate:deterministic",
        kind: "calculation",
        workerId: "calculation.v1",
        description: "按冻结输入执行确定性计算。",
        obligationIds: ["calculation"],
        dependencies: ["align:evidence"],
        mandatory: true,
        supported: true,
        status: "pending",
        reasonCodes: []
      },
      {
        id: "critique:counter-evidence",
        kind: "critique",
        workerId: "critique.v1",
        description: "挑战当前解释并列出缺口。",
        obligationIds: ["counter"],
        dependencies: [...sqlIds],
        mandatory: true,
        supported: true,
        status: "pending",
        reasonCodes: []
      },
      {
        id: "report:supported",
        kind: "report",
        workerId: "report.v1",
        description: "只投影有证据支持的 Claim。",
        obligationIds: ["report"],
        dependencies: ["calculate:deterministic", "critique:counter-evidence"],
        mandatory: true,
        supported: true,
        status: "pending",
        reasonCodes: []
      }
    );
    if (items.filter((item) => item.kind === "text2sql").length === 0) {
      const internal = obligations.find((item) => item.id === "internal");
      if (internal) {
        internal.status = "blocked";
        internal.reasonCodes = ["no_datasource_declared"];
      }
    }
    return items;
  }

  private uniqueKinds(kinds: AnalysisWorkKind[]): AnalysisWorkKind[] {
    return [...new Set(kinds)].sort();
  }
}

function obligation(
  id: string,
  kind: AnalysisProofObligation["kind"],
  description: string,
  mandatory = true,
  reasonCodes: string[] = []
): AnalysisProofObligation {
  return {
    id,
    kind,
    description,
    mandatory,
    status: reasonCodes.length > 0 ? "deferred" : "open",
    evidenceRefs: [],
    reasonCodes
  };
}
