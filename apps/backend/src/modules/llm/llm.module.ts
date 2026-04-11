import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { DataModule } from "../data/data.module";
import { FreeTextSqlExtractor } from "./free-text-sql-extractor";
import { LlmGatewayService } from "./llm-gateway.service";
import { LlmModelFactory } from "./llm-model-factory";
import { OpenAiCompatibleClient } from "./openai-compatible.client";
import { ProviderCatalogService } from "./provider-catalog.service";
import { ProviderRouterService } from "./provider-router.service";
import { SqlReadonlyTool } from "./tools/sql-readonly.tool";
import { ToolEventsMapper } from "./tools/tool-events.mapper";
import { ToolExecutionGuard } from "./tools/tool-execution-guard";
import { ToolRegistryService } from "./tools/tool-registry.service";

@Module({
  imports: [AppConfigModule, DataModule],
  providers: [
    LlmModelFactory,
    LlmGatewayService,
    ToolExecutionGuard,
    SqlReadonlyTool,
    ToolRegistryService,
    ToolEventsMapper,
    OpenAiCompatibleClient,
    FreeTextSqlExtractor,
    ProviderCatalogService,
    ProviderRouterService
  ],
  exports: [
    LlmModelFactory,
    LlmGatewayService,
    ToolRegistryService,
    ToolEventsMapper,
    OpenAiCompatibleClient,
    FreeTextSqlExtractor,
    ProviderCatalogService,
    ProviderRouterService
  ]
})
export class LlmModule {}
