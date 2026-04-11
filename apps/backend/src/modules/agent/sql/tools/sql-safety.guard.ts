import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../../common/domain-error";

@Injectable()
export class SqlSafetyGuard {
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

  assertReadOnlySql(sql: string): void {
    const normalized = sql.trim().toLowerCase();
    if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
      throw new DomainError(
        "TOOL_INPUT_INVALID",
        "Tool 仅允许执行只读 SQL（SELECT / WITH ... SELECT）。",
        400
      );
    }
    for (const keyword of this.forbiddenKeywords) {
      if (new RegExp(`\\b${keyword}\\b`, "i").test(normalized)) {
        throw new DomainError(
          "TOOL_INPUT_INVALID",
          `Tool SQL 包含受限关键字 ${keyword.toUpperCase()}。`,
          400
        );
      }
    }
  }
}
