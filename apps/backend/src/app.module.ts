import { Module } from "@nestjs/common";
import { AppConfigModule } from "./modules/config/config.module";
import { SystemModule } from "./modules/system/system.module";
import { DataModule } from "./modules/data/data.module";
import { AgentModule } from "./modules/agent/agent.module";
import { ChatModule } from "./modules/chat/chat.module";
import { EvalModule } from "./modules/eval/eval.module";
import { LlmModule } from "./modules/llm/llm.module";
import { ObservabilityModule } from "./modules/observability/observability.module";
import { DatasourceModule } from "./modules/datasource/datasource.module";
import { SettingsModule } from "./modules/settings/settings.module";

@Module({
  imports: [
    AppConfigModule,
    DatasourceModule,
    ObservabilityModule,
    DataModule,
    LlmModule,
    SettingsModule,
    AgentModule,
    ChatModule,
    EvalModule,
    SystemModule
  ]
})
export class AppModule {}
