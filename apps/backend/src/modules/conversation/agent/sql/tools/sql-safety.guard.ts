import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../../../common/domain-error";
import { AppConfigService } from "../../../../config/app-config.service";

export type SqlSafetyMode = "pass" | "soft-warn" | "hard-block";

export interface SqlSafetyDecision {
  allowed: boolean;
  mode: SqlSafetyMode;
  riskLevel: "low" | "medium" | "high";
  riskTags: string[];
  reason?: string;
}

@Injectable()
export class SqlSafetyGuard {
  constructor(private readonly config: AppConfigService) {}

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

  evaluate(sql: string, additionalRiskTags: string[] = []): SqlSafetyDecision {
    const normalized = sql.trim().toLowerCase();
    if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
      return {
        allowed: false,
        mode: "hard-block",
        riskLevel: "high",
        riskTags: ["non_readonly_statement"],
        reason: "Tool 仅允许执行只读 SQL（SELECT / WITH ... SELECT）。"
      };
    }

    for (const keyword of this.forbiddenKeywords) {
      if (new RegExp(`\\b${keyword}\\b`, "i").test(normalized)) {
        return {
          allowed: false,
          mode: "hard-block",
          riskLevel: "high",
          riskTags: [`forbidden_keyword:${keyword}`],
          reason: `Tool SQL 包含受限关键字 ${keyword.toUpperCase()}。`
        };
      }
    }

    const statementCount = normalized
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean).length;
    if (statementCount > 1) {
      return {
        allowed: false,
        mode: "hard-block",
        riskLevel: "high",
        riskTags: ["multi_statement"],
        reason: "Tool SQL 不允许多语句执行。"
      };
    }

    const riskTags: string[] = [];
    if (normalized.startsWith("with")) {
      riskTags.push("cte_query");
    }
    if (/\bselect\s+\*/i.test(normalized)) {
      riskTags.push("wide_projection");
    }
    if (!/\blimit\s+\d+\b/i.test(normalized)) {
      riskTags.push("unbounded_result");
    }
    if (normalized.length > this.config.sqlSafetySoftWarnMaxLength) {
      riskTags.push("long_sql");
    }
    for (const tag of additionalRiskTags) {
      const normalizedTag = tag.trim();
      if (normalizedTag && !riskTags.includes(normalizedTag)) {
        riskTags.push(normalizedTag);
      }
    }

    if (riskTags.length > 0) {
      return {
        allowed: true,
        mode: "soft-warn",
        riskLevel: "medium",
        riskTags
      };
    }

    return {
      allowed: true,
      mode: "pass",
      riskLevel: "low",
      riskTags: []
    };
  }

  assertReadOnlySql(sql: string): void {
    const decision = this.evaluate(sql);
    if (!decision.allowed) {
      throw new DomainError(
        "TOOL_INPUT_INVALID",
        decision.reason ?? "Tool SQL 未通过只读安全校验。",
        400,
        {
          mode: decision.mode,
          riskLevel: decision.riskLevel,
          riskTags: decision.riskTags
        }
      );
    }
  }
}
