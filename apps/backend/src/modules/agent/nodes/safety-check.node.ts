import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import {
  SqlTableAccessGuardService,
  type SqlTableAccessContext
} from "../../data/query/sql-table-access-guard.service";
import {
  SqlSafetyGuard,
  type SqlSafetyDecision
} from "../sql/tools/sql-safety.guard";

@Injectable()
export class SafetyCheckNode {
  constructor(
    private readonly tableAccessGuard: SqlTableAccessGuardService = new SqlTableAccessGuardService(),
    private readonly safetyGuard?: SqlSafetyGuard
  ) {}

  async run(input: {
    sql: string;
    datasourceId: string;
    accessContext?: SqlTableAccessContext;
  }): Promise<SqlSafetyDecision> {
    const readonlyDecision = this.evaluateReadonly(input.sql);
    if (!readonlyDecision.allowed) {
      return readonlyDecision;
    }

    if (input.accessContext?.allowedTables?.length) {
      try {
        await this.tableAccessGuard.assertTableAccess({
          sql: input.sql,
          datasourceId: input.datasourceId,
          accessContext: input.accessContext,
          allowedTables: input.accessContext.allowedTables
        });
      } catch (error) {
        return {
          allowed: false,
          mode: "hard-block",
          riskLevel: "high",
          riskTags: ["table_access_denied"],
          reason:
            error instanceof DomainError
              ? error.message
              : error instanceof Error
                ? error.message
                : "表级权限校验失败。"
        };
      }
    }

    return readonlyDecision;
  }

  private evaluateReadonly(sql: string): SqlSafetyDecision {
    if (this.safetyGuard) {
      return this.safetyGuard.evaluate(sql);
    }

    try {
      this.tableAccessGuard.assertReadOnlySql(sql);
    } catch (error) {
      return {
        allowed: false,
        mode: "hard-block",
        riskLevel: "high",
        riskTags: ["readonly_violation"],
        reason:
          error instanceof DomainError
            ? error.message
            : error instanceof Error
              ? error.message
              : "安全校验失败。"
      };
    }

    return {
      allowed: true,
      mode: "pass",
      riskLevel: "low",
      riskTags: []
    };
  }
}
