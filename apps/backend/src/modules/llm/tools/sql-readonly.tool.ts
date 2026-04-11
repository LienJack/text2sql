import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { SqliteQueryService } from "../../data/sqlite/sqlite-query.service";
import type { LlmGatewayToolDefinition } from "../llm-gateway.interface";
import { ToolExecutionGuard } from "./tool-execution-guard";

const sqlReadonlyInputSchema = z.object({
  sql: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional()
});

@Injectable()
export class SqlReadonlyTool {
  constructor(
    private readonly sqliteQuery: SqliteQueryService,
    private readonly guard: ToolExecutionGuard
  ) {}

  toDefinition(): LlmGatewayToolDefinition {
    return {
      description: "Execute a read-only SQL query against the SQLite datasource.",
      inputSchema: sqlReadonlyInputSchema,
      execute: async (input) => {
        const parsed = sqlReadonlyInputSchema.parse(input);
        this.guard.assertReadOnlySql(parsed.sql);
        const limit = parsed.limit ?? 50;
        const sql = this.ensureLimit(parsed.sql, limit);
        const result = await this.sqliteQuery.query(sql);
        return {
          rowCount: result.rows.length,
          columns: result.columns,
          rows: result.rows
        };
      }
    };
  }

  private ensureLimit(sql: string, limit: number): string {
    if (/\blimit\s+\d+\b/i.test(sql)) {
      return sql;
    }
    return `${sql.trim().replace(/;$/, "")} LIMIT ${limit}`;
  }
}
