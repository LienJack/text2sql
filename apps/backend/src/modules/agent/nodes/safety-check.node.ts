import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import {
  SqlTableAccessGuardService,
  type SqlTableAccessContext
} from "../../data/query/sql-table-access-guard.service";

@Injectable()
export class SafetyCheckNode {
  constructor(
    private readonly tableAccessGuard: SqlTableAccessGuardService = new SqlTableAccessGuardService()
  ) {}

  async run(input: {
    sql: string;
    datasourceId: string;
    accessContext?: SqlTableAccessContext;
  }): Promise<
    { safe: true } | { safe: false; reason: string; code?: string }
  > {
    try {
      this.tableAccessGuard.assertReadOnlySql(input.sql);
      if (input.accessContext?.allowedTables?.length) {
        await this.tableAccessGuard.assertTableAccess({
          sql: input.sql,
          datasourceId: input.datasourceId,
          accessContext: input.accessContext,
          allowedTables: input.accessContext.allowedTables
        });
      }
      return { safe: true };
    } catch (error) {
      if (error instanceof DomainError) {
        return {
          safe: false,
          reason: error.message,
          code: error.code
        };
      }
      return {
        safe: false,
        reason: error instanceof Error ? error.message : "安全校验失败。"
      };
    }
  }
}
