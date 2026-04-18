import { Module } from "@nestjs/common";
import { AppConfigModule } from "./modules/config/config.module";
import { SystemModule } from "./modules/system/system.module";
import { DataModule } from "./modules/data/data.module";
import { AgentModule } from "./modules/agent/agent.module";
import { ChatModule } from "./modules/chat/chat.module";
import { EvalModule } from "./modules/eval/eval.module";
import { LlmModule } from "./modules/llm/llm.module";
import { ObservabilityModule } from "./modules/observability/observability.module";
import { RagModule } from "./modules/rag/rag.module";
import { GovernanceModule } from "./modules/governance/governance.module";
import { SemanticRegistryModule } from "./modules/semantic-registry/semantic-registry.module";
import { GlossaryModule } from "./modules/glossary/glossary.module";

@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    RagModule,
    DataModule,
    LlmModule,
    GovernanceModule,
    SemanticRegistryModule,
    GlossaryModule,
    AgentModule,
    ChatModule,
    EvalModule,
    SystemModule
  ]
})
export class AppModule {}
