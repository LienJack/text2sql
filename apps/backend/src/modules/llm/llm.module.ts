import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { PlatformDataPersistenceModule } from "../platform/data/persistence.module";
import { EmbeddingRouterService } from "./embedding-router.service";
import { LlmGatewayService } from "./llm-gateway.service";
import { LlmModelFactory } from "./llm-model-factory";
import { ProviderCatalogService } from "./provider-catalog.service";
import { ProviderRouterService } from "./provider-router.service";
import { RagTaskConfigService } from "./rag-task-config.service";
import { RagTaskHealthProbeService } from "./rag-task-health-probe.service";
import { RerankRouterService } from "./rerank-router.service";
import { ToolEventsMapper } from "./tools/tool-events.mapper";

@Module({
  imports: [AppConfigModule, PlatformDataPersistenceModule],
  providers: [
    LlmModelFactory,
    LlmGatewayService,
    ToolEventsMapper,
    EmbeddingRouterService,
    RagTaskHealthProbeService,
    RagTaskConfigService,
    RerankRouterService,
    ProviderCatalogService,
    ProviderRouterService
  ],
  exports: [
    LlmModelFactory,
    LlmGatewayService,
    ToolEventsMapper,
    EmbeddingRouterService,
    RagTaskHealthProbeService,
    RagTaskConfigService,
    RerankRouterService,
    ProviderCatalogService,
    ProviderRouterService
  ]
})
export class LlmModule {}
