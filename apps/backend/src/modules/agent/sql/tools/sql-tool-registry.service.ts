import { Injectable } from "@nestjs/common";
import type { LlmGatewayToolDefinition } from "../../../llm/llm-gateway.interface";
import { SqlReadonlyTool } from "./sql-readonly.tool";

@Injectable()
export class SqlToolRegistryService {
  constructor(private readonly sqlReadonlyTool: SqlReadonlyTool) {}

  getTools(): Record<string, LlmGatewayToolDefinition> {
    return {
      runReadOnlySql: this.sqlReadonlyTool.toDefinition()
    };
  }
}
