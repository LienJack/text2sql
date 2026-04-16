import { Injectable } from "@nestjs/common";
import type { RetrievedKnowledge } from "./retrieve-knowledge.node";

export interface IntentPlan {
  status: "ready" | "degraded";
  intent: "aggregate" | "detail" | "compare" | "unknown";
  constraints: string[];
  summary: string;
}

@Injectable()
export class BuildIntentPlanNode {
  run(question: string, knowledge: RetrievedKnowledge): IntentPlan {
    const normalized = question.toLowerCase();
    if (knowledge.status === "degraded") {
      return {
        status: "degraded",
        intent: "unknown",
        constraints: [],
        summary: "检索上下文不可用，意图规划降级。"
      };
    }

    if (/统计|总数|分布|汇总/.test(normalized)) {
      return {
        status: "ready",
        intent: "aggregate",
        constraints: ["prefer_group_by"],
        summary: "意图识别为聚合统计。"
      };
    }
    if (/对比|比较|同比|环比/.test(normalized)) {
      return {
        status: "ready",
        intent: "compare",
        constraints: ["require_two_dimensions"],
        summary: "意图识别为对比分析。"
      };
    }

    return {
      status: "ready",
      intent: "detail",
      constraints: [],
      summary: "意图识别为明细查询。"
    };
  }
}
