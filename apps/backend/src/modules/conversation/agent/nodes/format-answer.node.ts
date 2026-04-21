import { Injectable } from "@nestjs/common";

@Injectable()
export class FormatAnswerNode {
  run(
    question: string,
    rows: Array<Record<string, unknown>>,
    columns: string[]
  ): string {
    if (rows.length === 0) {
      return "查询已执行，但没有匹配数据。你可以补充时间范围或筛选条件。";
    }
    const preview = rows.slice(0, 3);
    return [
      `已完成查询：${question}`,
      `返回 ${rows.length} 行，字段为：${columns.join(", ") || "无"}`,
      `样例结果：${JSON.stringify(preview)}`
    ].join("\n");
  }
}
