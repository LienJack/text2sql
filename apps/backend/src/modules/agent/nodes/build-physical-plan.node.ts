import { Injectable } from "@nestjs/common";
import type { SemanticQueryPlan } from "./build-semantic-query.node";

export interface PhysicalPlan {
  status: "ready" | "degraded";
  strategy: "direct_sql" | "fallback_sql";
  summary: string;
}

@Injectable()
export class BuildPhysicalPlanNode {
  run(semanticPlan: SemanticQueryPlan): PhysicalPlan {
    if (semanticPlan.status === "degraded") {
      return {
        status: "degraded",
        strategy: "fallback_sql",
        summary: "语义阶段降级，改用兼容执行策略。"
      };
    }

    return {
      status: "ready",
      strategy: "direct_sql",
      summary: "已生成最小物理执行计划。"
    };
  }
}
