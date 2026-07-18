import { Module } from "@nestjs/common";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { GovernanceAccessModule } from "../../governance/access/access.module";
import { DatasourceModule } from "../../governance/datasource/datasource.module";
import { LlmModule } from "../../llm/llm.module";
import { ObservabilityModule } from "../../observability/observability.module";
import { KnowledgeModule } from "../../knowledge/knowledge.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ExecuteMessageUsecase } from "./application/execute-message.usecase";
import { RunViewUsecase } from "./application/run-view.usecase";
import { SaveViewFromRunUsecase } from "./application/save-view-from-run.usecase";
import { SessionLifecycleUsecase } from "./application/session-lifecycle.usecase";
import { StreamMessageUsecase } from "./application/stream-message.usecase";
import { Text2SqlModule } from "../text2sql/text2sql.module";

@Module({
  imports: [
    PlatformDataPersistenceModule,
    GovernanceAccessModule,
    DatasourceModule,
    LlmModule,
    ObservabilityModule,
    KnowledgeModule,
    Text2SqlModule
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    SessionLifecycleUsecase,
    ExecuteMessageUsecase,
    StreamMessageUsecase,
    RunViewUsecase,
    SaveViewFromRunUsecase,
  ],
  exports: [ChatService, SessionLifecycleUsecase]
})
export class ChatModule {}
