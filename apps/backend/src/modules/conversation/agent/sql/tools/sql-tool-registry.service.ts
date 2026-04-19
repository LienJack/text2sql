import { Injectable } from "@nestjs/common";
import type { Datasource } from "@text2sql/shared-types";
import type { LlmGatewayToolDefinition } from "../../../../llm/llm-gateway.interface";
import type { SqlTableAccessContext } from "../../../../data/query/sql-table-access-guard.service";
import { SqlReadonlyTool } from "./sql-readonly.tool";

@Injectable()
export class SqlToolRegistryService {
  constructor(private readonly sqlReadonlyTool: SqlReadonlyTool) {}

  getToolsForDatasource(
    datasource: Datasource,
    options?: {
      accessContext?: SqlTableAccessContext;
    }
  ): Record<string, LlmGatewayToolDefinition> {
    return {
      runReadOnlySql: this.sqlReadonlyTool.toDefinition({
        datasource,
        accessContext: options?.accessContext
      })
    };
  }
}
