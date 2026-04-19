import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { GovernanceAccessModule } from "../../governance/access/access.module";
import { DatasourceModule } from "../../governance/datasource/datasource.module";
import { LlmModule } from "../../llm/llm.module";
import { ObservabilityModule } from "../../observability/observability.module";
import { KnowledgeModule } from "../../knowledge/knowledge.module";
import { DeliveryContractMapper } from "../delivery/delivery-contract.mapper";
import { SandboxRuntimeService } from "../delivery/sandbox/sandbox-runtime.service";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ExecuteMessageUsecase } from "./application/execute-message.usecase";
import { RunViewUsecase } from "./application/run-view.usecase";
import { SessionLifecycleUsecase } from "./application/session-lifecycle.usecase";
import { StreamMessageUsecase } from "./application/stream-message.usecase";
import { ChatDeliveryEnrichmentService } from "./application/shared/chat-delivery-enrichment.service";
import { ChatPolicyGuardService } from "./application/shared/chat-policy-guard.service";
import { ChatPostRunHooksService } from "./application/shared/chat-post-run-hooks.service";
import { ChatRunPersistenceService } from "./application/shared/chat-run-persistence.service";

@Module({
  imports: [
    AgentModule,
    PlatformDataPersistenceModule,
    GovernanceAccessModule,
    DatasourceModule,
    LlmModule,
    ObservabilityModule,
    KnowledgeModule
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    DeliveryContractMapper,
    SandboxRuntimeService,
    SessionLifecycleUsecase,
    ExecuteMessageUsecase,
    StreamMessageUsecase,
    RunViewUsecase,
    ChatPostRunHooksService,
    ChatPolicyGuardService,
    ChatRunPersistenceService,
    ChatDeliveryEnrichmentService
  ],
  exports: [ChatService]
})
export class ChatModule {}
