import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { PlatformDataModule } from "../platform/data/data.module";
import { DatasourceModule } from "../governance/datasource/datasource.module";
import { ObservabilityModule } from "../observability/observability.module";
import { RagModule } from "../knowledge/rag/rag.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    AppConfigModule,
    PlatformDataModule,
    DatasourceModule,
    ObservabilityModule,
    RagModule
  ],
  controllers: [HealthController]
})
export class SystemModule {}
