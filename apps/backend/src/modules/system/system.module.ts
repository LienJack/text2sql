import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { PlatformDataPersistenceModule } from "../platform/data/persistence.module";
import { DatasourceModule } from "../governance/datasource/datasource.module";
import { PlatformObservabilityModule } from "../platform/observability/observability.module";
import { RagModule } from "../knowledge/rag/rag.module";
import { LlmModule } from "../llm/llm.module";
import { HealthController } from "./health.controller";
import { PlatformDurableModule } from "../platform/durable/platform-durable.module";

@Module({
  imports: [
    AppConfigModule,
    PlatformDataPersistenceModule,
    DatasourceModule,
    PlatformObservabilityModule,
    RagModule,
    LlmModule,
    PlatformDurableModule
  ],
  controllers: [HealthController]
})
export class SystemModule {}
