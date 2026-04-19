import { Module } from "@nestjs/common";
import { EvalModule } from "../eval/eval.module";
import { PlatformConfigModule } from "./config/config.module";
import { PlatformLlmModule } from "./llm/llm.module";
import { PlatformObservabilityModule } from "./observability/observability.module";
import { PlatformDataBootstrapModule } from "./data/bootstrap.module";
import { PlatformDataPersistenceModule } from "./data/persistence.module";
import { PlatformDataQueryModule } from "./data/query.module";
import { SystemModule } from "../system/system.module";
import { PlatformChatRuntimeFacade } from "./platform-chat-runtime.facade";

@Module({
  imports: [
    PlatformConfigModule,
    PlatformObservabilityModule,
    PlatformDataPersistenceModule,
    PlatformDataQueryModule,
    PlatformDataBootstrapModule,
    PlatformLlmModule,
    EvalModule,
    SystemModule
  ],
  providers: [PlatformChatRuntimeFacade],
  exports: [
    PlatformChatRuntimeFacade,
    PlatformConfigModule,
    PlatformObservabilityModule,
    PlatformDataPersistenceModule,
    PlatformDataQueryModule,
    PlatformDataBootstrapModule,
    PlatformLlmModule,
    EvalModule,
    SystemModule
  ]
})
export class PlatformModule {}
