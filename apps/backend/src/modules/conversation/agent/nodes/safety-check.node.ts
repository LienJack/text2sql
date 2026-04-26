import { Injectable, Optional } from "@nestjs/common";
import type { DatasourceType, SemanticPlanV1 } from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import {
  SqlTableAccessGuardService,
  type SqlTableAccessContext
} from "../../../platform/data/query/index";
import {
  SqlSafetyGuard,
  type SqlSafetyDecision
} from "../sql/tools/sql-safety.guard";
import { SqlValidationService } from "../v2/sql-validation.service";

@Injectable()
export class SafetyCheckNode {
  constructor(
    private readonly tableAccessGuard: SqlTableAccessGuardService = new SqlTableAccessGuardService(),
    private readonly safetyGuard?: SqlSafetyGuard,
    @Optional()
    private readonly sqlValidationService?: SqlValidationService
  ) {}

  async run(input: {
    sql: string;
    datasourceId: string;
    datasourceType?: DatasourceType;
    semanticPlan?: SemanticPlanV1;
    accessContext?: SqlTableAccessContext;
    riskTags?: string[];
  }): Promise<SqlSafetyDecision> {
    if (this.sqlValidationService) {
      const validation = this.sqlValidationService.validate({
        sql: input.sql,
        datasourceType: input.datasourceType,
        semanticPlan: input.semanticPlan
      });
      if (validation.status === "failed" && validation.failure) {
        if (validation.failure.correctable) {
          return {
            allowed: true,
            mode: "soft-warn",
            riskLevel: "medium",
            riskTags: ["correctable_validation_failure", validation.failure.code],
            reason: validation.failure.message
          };
        }
        return {
          allowed: false,
          mode: "hard-block",
          riskLevel: "high",
          riskTags: ["terminal_validation_failure", validation.failure.code],
          reason: validation.failure.message
        };
      }
    }

    const readonlyDecision = this.evaluateReadonly(input.sql, input.riskTags);
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

  private evaluateReadonly(sql: string, riskTags?: string[]): SqlSafetyDecision {
    if (this.safetyGuard) {
      return this.safetyGuard.evaluate(sql, riskTags);
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
