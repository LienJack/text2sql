import { Injectable } from "@nestjs/common";
import type { SemanticQueryPlan } from "./build-semantic-query.node";
import { PlannerCacheService, type PlannerCacheStatus } from "../planner/planner-cache.service";

export interface PhysicalPlan {
  status: "ready" | "degraded";
  strategy: "direct_sql" | "fallback_sql";
  semanticConstraintMode: "structured" | "fallback_text";
  semanticVersion?: number;
  lockStatus: "locked" | "fallback" | "degraded";
  fallbackApplied: boolean;
  cacheStatus: PlannerCacheStatus;
  cacheKey?: string;
  cacheReason?: string;
  summary: string;
}

@Injectable()
export class BuildPhysicalPlanNode {
  constructor(private readonly plannerCache: PlannerCacheService) {}

  async run(input: {
    semanticPlan: SemanticQueryPlan;
    question: string;
    datasourceId: string;
  }): Promise<PhysicalPlan> {
    const { semanticPlan } = input;
    const requiresClarification = semanticPlan.semanticHints.includes(
      "route_clarification_required"
    );
    const requiresFailClosed = semanticPlan.semanticHints.includes(
      "route_fail_closed_for_write_intent"
    );
    if (requiresClarification || requiresFailClosed) {
      const summary = requiresFailClosed
        ? "检测到写操作意图，执行计划按 fail-closed 降级。"
        : "语义路由要求澄清，执行计划降级并等待补充信息。";
      return {
        status: "degraded",
        strategy: "fallback_sql",
        semanticConstraintMode: "fallback_text",
        semanticVersion: semanticPlan.semanticVersion,
        lockStatus: semanticPlan.lockStatus,
        fallbackApplied: true,
        cacheStatus: "miss",
        cacheReason: requiresFailClosed
          ? "semantic_route_fail_closed"
          : "semantic_route_clarify",
        summary
      };
    }

    if (semanticPlan.status === "degraded" && !semanticPlan.semanticVersion) {
      return {
        status: "degraded",
        strategy: "fallback_sql",
        semanticConstraintMode: "fallback_text",
        semanticVersion: undefined,
        lockStatus: semanticPlan.lockStatus,
        fallbackApplied: semanticPlan.fallbackApplied,
        cacheStatus: "miss",
        cacheReason: "semantic_version_missing",
        summary: "语义阶段降级且无可用版本，改用兼容执行策略。"
      };
    }

    const cacheLookup = this.plannerCache.lookup({
      datasourceId: input.datasourceId,
      question: input.question,
      semanticVersion: semanticPlan.semanticVersion
    });
    if (cacheLookup.status === "hit" && cacheLookup.entry) {
      return {
        status: semanticPlan.status,
        strategy: cacheLookup.entry.strategy,
        semanticConstraintMode:
          semanticPlan.semanticBindingSummary?.metricBindingCount ||
          semanticPlan.semanticBindingSummary?.relationshipBindingCount ||
          semanticPlan.semanticBindingSummary?.calculatedFieldBindingCount
            ? "structured"
            : "fallback_text",
        semanticVersion: semanticPlan.semanticVersion,
        lockStatus: semanticPlan.lockStatus,
        fallbackApplied: semanticPlan.fallbackApplied,
        cacheStatus: "hit",
        cacheKey: cacheLookup.cacheKey,
        summary: `${cacheLookup.entry.summary}（planner cache hit）`
      };
    }

    const strategy =
      semanticPlan.status === "ready" && semanticPlan.lockStatus === "locked"
        ? "direct_sql"
        : "fallback_sql";
    const semanticConstraintMode =
      semanticPlan.semanticBindingSummary?.metricBindingCount ||
      semanticPlan.semanticBindingSummary?.relationshipBindingCount ||
      semanticPlan.semanticBindingSummary?.calculatedFieldBindingCount
        ? "structured"
        : "fallback_text";
    const summary =
      strategy === "direct_sql"
        ? "已生成最小物理执行计划。"
        : "语义阶段降级，改用兼容执行策略。";

    if (semanticPlan.semanticVersion) {
      this.plannerCache.invalidateByDatasourceAndSemanticVersion(
        input.datasourceId,
        semanticPlan.semanticVersion
      );
      this.plannerCache.store({
        datasourceId: input.datasourceId,
        question: input.question,
        semanticVersion: semanticPlan.semanticVersion,
        strategy,
        summary
      });
    }

    return {
      status: strategy === "direct_sql" ? "ready" : "degraded",
      strategy,
      semanticConstraintMode,
      semanticVersion: semanticPlan.semanticVersion,
      lockStatus: semanticPlan.lockStatus,
      fallbackApplied: semanticPlan.fallbackApplied,
      cacheStatus: cacheLookup.status,
      cacheKey: cacheLookup.cacheKey,
      cacheReason: cacheLookup.reason,
      summary
    };
  }
}
