import { Injectable } from "@nestjs/common";

@Injectable()
export class SafetyCheckNode {
  private readonly forbiddenKeywords = [
    "insert",
    "update",
    "delete",
    "drop",
    "alter",
    "truncate",
    "create",
    "replace",
    "attach",
    "pragma"
  ];

  run(sql: string): { safe: true } | { safe: false; reason: string } {
    const normalized = sql.trim().toLowerCase();
    if (!normalized.startsWith("select")) {
      return {
        safe: false,
        reason: "只允许 SELECT 查询，禁止写入或结构变更语句。"
      };
    }
    for (const keyword of this.forbiddenKeywords) {
      if (new RegExp(`\\b${keyword}\\b`, "i").test(normalized)) {
        return {
          safe: false,
          reason: `检测到受限关键字 ${keyword.toUpperCase()}，已拒绝执行。`
        };
      }
    }
    return { safe: true };
  }
}

