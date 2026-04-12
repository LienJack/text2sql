import { Injectable } from "@nestjs/common";

export interface RetrievedKnowledge {
  status: "ready" | "degraded";
  snippets: string[];
  summary: string;
}

@Injectable()
export class RetrieveKnowledgeNode {
  run(question: string): RetrievedKnowledge {
    const normalized = question.trim();
    if (!normalized) {
      return {
        status: "degraded",
        snippets: [],
        summary: "检索输入为空，已降级到最小执行路径。"
      };
    }

    return {
      status: "ready",
      snippets: [normalized.slice(0, 120)],
      summary: "已生成最小检索上下文。"
    };
  }
}
