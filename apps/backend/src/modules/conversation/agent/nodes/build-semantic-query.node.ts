import { Injectable } from "@nestjs/common";
import type { IntentPlan } from "./build-intent-plan.node";
import type { RetrievedKnowledge } from "./retrieve-knowledge.node";
import { PlannerVersionLockService } from "../planner/planner-version-lock.service";

type RagRetrievalBundle = NonNullable<RetrievedKnowledge["retrievalBundle"]>;

export interface SemanticQueryPlan {
  status: "ready" | "degraded";
  semanticHints: string[];
  semanticVersion?: number;
  lockStatus: "locked" | "fallback" | "degraded";
  fallbackApplied: boolean;
  degradeReason?: string;
  riskTags: string[];
  summary: string;
}

@Injectable()
export class BuildSemanticQueryNode {
  constructor(private readonly plannerVersionLock: PlannerVersionLockService) {}

  async run(input: {
    intentPlan: IntentPlan;
    question: string;
    retrievalBundle?: RagRetrievalBundle;
    requestedSemanticVersion?: number;
  }): Promise<SemanticQueryPlan> {
    const { intentPlan } = input;
    if (intentPlan.status === "degraded") {
      return {
        status: "degraded",
        semanticHints: [],
        lockStatus: "degraded",
        fallbackApplied: false,
        riskTags: [],
        summary: "意图规划不可用，语义检索降级。"
      };
    }

    const versionLock = await this.plannerVersionLock.resolve({
      question: input.question,
      retrievalBundle: input.retrievalBundle,
      requestedSemanticVersion: input.requestedSemanticVersion
    });

    const semanticHints =
      intentPlan.intent === "aggregate"
        ? ["use_metric_aliases", "prefer_dimension_filters"]
        : intentPlan.intent === "compare"
          ? ["normalize_time_window", "keep_metric_consistency"]
          : ["prefer_direct_lookup"];
    if (intentPlan.constraints.includes("must_use_selected_context")) {
      semanticHints.push("must_consume_selected_context");
    }

    if (versionLock.lockStatus === "degraded") {
      return {
        status: "degraded",
        semanticHints,
        semanticVersion: versionLock.semanticVersion,
        lockStatus: "degraded",
        fallbackApplied: false,
        degradeReason: versionLock.degradeReason,
        riskTags: versionLock.riskTags,
        summary: `语义版本锁降级：${versionLock.degradeReason ?? "unknown"}`
      };
    }

    if (versionLock.lockStatus === "fallback") {
      return {
        status: "degraded",
        semanticHints,
        semanticVersion: versionLock.semanticVersion,
        lockStatus: "fallback",
        fallbackApplied: true,
        degradeReason: versionLock.degradeReason,
        riskTags: versionLock.riskTags,
        summary:
          "语义版本不存在，已回退到最近稳定版本并标记降级路径。"
      };
    }

    return {
      status: "ready",
      semanticHints,
      semanticVersion: versionLock.semanticVersion,
      lockStatus: "locked",
      fallbackApplied: false,
      riskTags: versionLock.riskTags,
      summary: "已生成语义检索提示并完成版本锁定。"
    };
  }
}
