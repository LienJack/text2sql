import { Module } from "@nestjs/common";
import { EvalModule } from "../eval/eval.module";
import { PlatformConfigModule } from "./config/config.module";
import { PlatformLlmModule } from "./llm/llm.module";
import { PlatformObservabilityModule } from "./observability/observability.module";
import { PlatformDataModule } from "./data/data.module";
import { SystemModule } from "../system/system.module";

@Module({
  imports: [
    PlatformConfigModule,
    PlatformObservabilityModule,
    PlatformDataModule,
    PlatformLlmModule,
    EvalModule,
    SystemModule
  ],
  exports: [
    PlatformConfigModule,
    PlatformObservabilityModule,
    PlatformDataModule,
    PlatformLlmModule,
    EvalModule,
    SystemModule
  ]
})
export class PlatformModule {}
