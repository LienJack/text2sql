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

    const normalizedColumns = this.normalizeColumns(columns, rows);
    const numericColumns = normalizedColumns.filter((column) =>
      this.isNumeric(rows[0]?.[column])
    );
    const lead = `已完成分析：${question}`;
    const coverage = `共返回 ${rows.length} 条记录（字段：${normalizedColumns.slice(0, 4).join("、") || "未命名字段"}${
      normalizedColumns.length > 4 ? " 等" : ""
    }）。`;
    const metricSummary = this.buildMetricSummary(rows, numericColumns);

    return [lead, coverage, metricSummary, "如需核验明细，可展开图表、表格或 SQL 证据。"]
      .filter((line) => line.length > 0)
      .join("\n");
  }

  runDirectAnswer(answer: string, warnings: string[] = []): string {
    return [answer.trim(), ...warnings.map((warning) => `说明：${warning}`)]
      .filter((line) => line.length > 0)
      .join("\n");
  }

  runFailClosed(reason: string, guidance?: string): string {
    return [
      "当前请求未通过安全或治理校验，系统已按 fail-closed 终止。",
      reason.trim(),
      guidance?.trim() || "请改为只读分析问题，或补充更明确且合规的分析范围后重试。"
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }

  private buildMetricSummary(
    rows: Array<Record<string, unknown>>,
    numericColumns: string[]
  ): string {
    if (rows.length === 0 || numericColumns.length === 0) {
      return "当前结果以明细数据为主，已生成可读预览。";
    }

    const firstRow = rows[0] ?? {};
    const fragments = numericColumns.slice(0, 2).map((column) => {
      const value = firstRow[column];
      return `${column}=${this.formatValue(value)}`;
    });
    if (fragments.length === 0) {
      return "当前结果以明细数据为主，已生成可读预览。";
    }
    return `核心指标摘要：${fragments.join("，")}。`;
  }

  private normalizeColumns(
    columns: string[],
    rows: Array<Record<string, unknown>>
  ): string[] {
    const candidates =
      columns.length > 0
        ? columns
        : rows.length > 0
          ? Object.keys(rows[0] ?? {})
          : [];
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const value of candidates) {
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      deduped.push(trimmed);
    }
    return deduped;
  }

  private isNumeric(value: unknown): boolean {
    if (typeof value === "number" && Number.isFinite(value)) {
      return true;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return Number.isFinite(Number(value));
    }
    return false;
  }

  private formatValue(value: unknown): string {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (value === null || value === undefined) {
      return "n/a";
    }
    return String(value);
  }
}
