import { Injectable } from "@nestjs/common";
import type { ClarificationPrompt } from "@text2sql/shared-types";

@Injectable()
export class ClarifyNode {
  private readonly ambiguousPatterns = [
    /这个/,
    /那个/,
    /帮我查一下/,
    /看看情况/,
    /看看.*情况/,
    /看看/
  ];

  run(question: string): ClarificationPrompt | undefined {
    const trimmed = question.trim();
    if (trimmed.length < 6) {
      return {
        reason: "问题信息不足",
        question: "请补充时间范围和分析对象，例如“近30天退款金额最高的商家有哪些？”"
      };
    }
    if (this.ambiguousPatterns.some((regex) => regex.test(trimmed))) {
      return {
        reason: "问题语义不明确",
        question: "请说明你希望查看的指标、时间范围和维度。"
      };
    }
    return undefined;
  }
}
