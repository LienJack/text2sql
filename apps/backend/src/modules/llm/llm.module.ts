import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { PlatformDataPersistenceModule } from "../platform/data/persistence.module";
import { LlmGatewayService } from "./llm-gateway.service";
import { LlmModelFactory } from "./llm-model-factory";
import { ProviderCatalogService } from "./provider-catalog.service";
import { ProviderRouterService } from "./provider-router.service";
import { ToolEventsMapper } from "./tools/tool-events.mapper";

@Module({
  imports: [AppConfigModule, PlatformDataPersistenceModule],
  providers: [
    LlmModelFactory,
    LlmGatewayService,
    ToolEventsMapper,
    ProviderCatalogService,
    ProviderRouterService
  ],
  exports: [
    LlmModelFactory,
    LlmGatewayService,
    ToolEventsMapper,
    ProviderCatalogService,
    ProviderRouterService
  ]
})
export class LlmModule {}
