import { Injectable } from "@nestjs/common";
import type { Datasource } from "@text2sql/shared-types";
import { z } from "zod";
import {
  QueryExecutorRouterService,
  type SqlTableAccessContext
} from "../../../../platform/data/query/index";
import type { LlmGatewayToolDefinition } from "../../../../llm/llm-gateway.interface";
import { DomainError } from "../../../../../common/domain-error";
import type { AccessContext } from "../../../../governance/access/datasource-access-policy.service";
import { PolicyEvaluatorService } from "../../../../governance/access/policy-evaluator.service";

const sqlReadonlyInputSchema = z.object({
  sql: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional()
});

@Injectable()
export class SqlReadonlyTool {
  constructor(
    private readonly queryExecutorRouter: QueryExecutorRouterService,
    private readonly policyEvaluatorService: PolicyEvaluatorService
  ) {}

  toDefinition(context: {
    datasource: Datasource;
    accessContext?: SqlTableAccessContext;
  }): LlmGatewayToolDefinition {
    return {
      description: `Execute a read-only SQL query against datasource ${context.datasource.id} (${context.datasource.type}).`,
      inputSchema: sqlReadonlyInputSchema,
      execute: async (toolInput) => {
        const parsed = sqlReadonlyInputSchema.parse(toolInput);
        if (context.datasource.status !== "available") {
          throw new DomainError(
            "DATASOURCE_UNAVAILABLE",
            "当前会话绑定的数据源不可用，请先重新选择数据源。",
            409,
            {
              datasourceId: context.datasource.id,
              status: context.datasource.status
            }
          );
        }
        const policyResult =
          context.accessContext?.actorId &&
          context.accessContext.workspaceId &&
          context.accessContext.roleSet
            ? await this.resolvePolicy(context.accessContext, context.datasource.id)
            : undefined;
        const result = await this.queryExecutorRouter.execute({
          datasource: context.datasource,
          sql: parsed.sql,
          limit: parsed.limit ?? 50,
          tablePermissions: context.accessContext
            ? {
                accessContext: {
                  ...context.accessContext,
                  evaluatorMode:
                    policyResult?.mode ?? context.accessContext.evaluatorMode,
                  allowedColumnsByTable: policyResult?.allowedColumnsByTable ?? {},
                  rowFiltersByTable: policyResult?.rowFiltersByTable ?? {}
                },
                allowedTables: policyResult?.readableTables
              }
            : undefined
        });
        return {
          rowCount: result.rows.length,
          columns: result.columns,
          rows: result.rows
        };
      }
    };
  }

  private async resolvePolicy(
    context: SqlTableAccessContext,
    datasourceId: string
  ): Promise<{
    mode: "workspace_table_permissions";
    readableTables: string[];
    allowedColumnsByTable: Record<string, string[]>;
    rowFiltersByTable: Record<string, string>;
  } | undefined> {
    if (!context.actorId || !context.workspaceId || !context.roleSet) {
      return undefined;
    }
    const readable = await this.policyEvaluatorService.resolveReadableTables({
      context: {
        actorId: context.actorId,
        workspaceId: context.workspaceId,
        roleSet: context.roleSet
      } as AccessContext,
      datasourceId
    });
    return {
      mode: readable.mode,
      readableTables: readable.readableTables,
      allowedColumnsByTable: readable.allowedColumnsByTable,
      rowFiltersByTable: readable.rowFiltersByTable
    };
  }
}
