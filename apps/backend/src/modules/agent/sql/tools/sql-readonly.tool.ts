import { Injectable } from "@nestjs/common";
import type { Datasource } from "@text2sql/shared-types";
import { z } from "zod";
import { QueryExecutorRouterService } from "../../../data/query/query-executor-router.service";
import type { LlmGatewayToolDefinition } from "../../../llm/llm-gateway.interface";
import { DomainError } from "../../../../common/domain-error";

const sqlReadonlyInputSchema = z.object({
  sql: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional()
});

@Injectable()
export class SqlReadonlyTool {
  constructor(private readonly queryExecutorRouter: QueryExecutorRouterService) {}

  toDefinition(context: { datasource: Datasource }): LlmGatewayToolDefinition {
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
        const result = await this.queryExecutorRouter.execute({
          datasource: context.datasource,
          sql: parsed.sql,
          limit: parsed.limit ?? 50
        });
        return {
          rowCount: result.rows.length,
          columns: result.columns,
          rows: result.rows
        };
      }
    };
  }
}
