import { Injectable } from "@nestjs/common";
import type { IntentPlan } from "./build-intent-plan.node";
import type { RetrievedKnowledge } from "./retrieve-knowledge.node";
import { PlannerVersionLockService } from "../planner/planner-version-lock.service";

type RagRetrievalBundle = NonNullable<RetrievedKnowledge["retrievalBundle"]>;

export interface SemanticQueryPlan {
  status: "ready" | "degraded";
  semanticHints: string[];
  modelingRevision?: number;
  semanticBindingSummary?: {
    modelBindingCount: number;
    relationshipBindingCount: number;
    metricBindingCount: number;
    calculatedFieldBindingCount: number;
    contextPackStatus?: "ready" | "degraded";
    modelingRevision?: number;
  };
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
    const contextPack = input.retrievalBundle?.context_pack;
    const contextPackRecord = contextPack as Record<string, unknown> | undefined;
    const modelingRevisionRaw =
      contextPackRecord?.modelingRevision ?? contextPackRecord?.modeling_revision;
    const modelingRevision =
      typeof modelingRevisionRaw === "number" && Number.isFinite(modelingRevisionRaw)
        ? Math.floor(modelingRevisionRaw)
        : undefined;

    const semanticHints =
      intentPlan.intent === "aggregate"
        ? ["use_metric_aliases", "prefer_dimension_filters"]
        : intentPlan.intent === "compare"
          ? ["normalize_time_window", "keep_metric_consistency"]
          : ["prefer_direct_lookup"];
    if (intentPlan.constraints.includes("must_use_selected_context")) {
      semanticHints.push("must_consume_selected_context");
    }
    if (contextPack?.instruction_sets.metric_bindings.length) {
      semanticHints.push("prefer_structured_metric_bindings");
    }
    if (contextPack?.instruction_sets.relationship_bindings.length) {
      semanticHints.push("prefer_structured_relationship_bindings");
    }
    if (contextPack?.status === "degraded") {
      semanticHints.push("semantic_context_pack_degraded");
    }

    const semanticBindingSummary = contextPack
      ? {
          modelBindingCount: contextPack.instruction_sets.model_bindings.length,
          relationshipBindingCount:
            contextPack.instruction_sets.relationship_bindings.length,
          metricBindingCount: contextPack.instruction_sets.metric_bindings.length,
          calculatedFieldBindingCount:
            contextPack.instruction_sets.calculated_field_bindings.length,
          contextPackStatus: contextPack.status,
          modelingRevision
        }
      : undefined;

    if (versionLock.lockStatus === "degraded") {
      return {
        status: "degraded",
        semanticHints,
        modelingRevision,
        semanticBindingSummary,
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
        modelingRevision,
        semanticBindingSummary,
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
      modelingRevision,
      semanticBindingSummary,
      semanticVersion: versionLock.semanticVersion,
      lockStatus: "locked",
      fallbackApplied: false,
      riskTags: versionLock.riskTags,
      summary: "已生成语义检索提示并完成版本锁定。"
    };
  }
}
