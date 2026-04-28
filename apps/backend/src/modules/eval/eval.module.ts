import { Module } from "@nestjs/common";
import { Text2SqlModule } from "../conversation/text2sql/text2sql.module";
import { PlatformDataPersistenceModule } from "../platform/data/persistence.module";
import { AppConfigModule } from "../config/config.module";
import { ObservabilityModule } from "../observability/observability.module";
import { EvalController } from "./eval.controller";
import { EvalService } from "./eval.service";

@Module({
  imports: [
    Text2SqlModule,
    PlatformDataPersistenceModule,
    AppConfigModule,
    ObservabilityModule
  ],
  controllers: [EvalController],
  providers: [EvalService],
  exports: [EvalService]
})
export class EvalModule {}
