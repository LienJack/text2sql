import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { DataModule } from "../data/data.module";
import { DatasourceModule } from "../datasource/datasource.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [AppConfigModule, DataModule, DatasourceModule],
  controllers: [HealthController]
})
export class SystemModule {}

