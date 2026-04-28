import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { PlatformDataPersistenceModule } from "../platform/data/persistence.module";
import { DatasourceModule } from "../governance/datasource/datasource.module";
import { ObservabilityModule } from "../observability/observability.module";
import { RagModule } from "../knowledge/rag/rag.module";
import { LlmModule } from "../llm/llm.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    AppConfigModule,
    PlatformDataPersistenceModule,
    DatasourceModule,
    ObservabilityModule,
    RagModule,
    LlmModule
  ],
  controllers: [HealthController]
})
export class SystemModule {}
