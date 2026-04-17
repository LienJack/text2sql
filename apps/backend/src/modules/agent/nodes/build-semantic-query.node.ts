import { Injectable } from "@nestjs/common";
import type { IntentPlan } from "./build-intent-plan.node";

export interface SemanticQueryPlan {
  status: "ready" | "degraded";
  semanticHints: string[];
  summary: string;
}

@Injectable()
export class BuildSemanticQueryNode {
  run(intentPlan: IntentPlan): SemanticQueryPlan {
    if (intentPlan.status === "degraded") {
      return {
        status: "degraded",
        semanticHints: [],
        summary: "意图规划不可用，语义检索降级。"
      };
    }

    const semanticHints =
      intentPlan.intent === "aggregate"
        ? ["use_metric_aliases", "prefer_dimension_filters"]
        : intentPlan.intent === "compare"
          ? ["normalize_time_window", "keep_metric_consistency"]
          : ["prefer_direct_lookup"];
    if (intentPlan.constraints.includes("must_use_selected_context")) {
      semanticHints.push("must_consume_selected_context");
    }

    return {
      status: "ready",
      semanticHints,
      summary: "已生成语义检索提示。"
    };
  }
}
