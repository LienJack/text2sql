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
import { SaveViewFromRunUsecase } from "./application/save-view-from-run.usecase";
import { SessionLifecycleUsecase } from "./application/session-lifecycle.usecase";
import { StreamMessageUsecase } from "./application/stream-message.usecase";
import { ChatDeliveryEnrichmentService } from "./application/shared/chat-delivery-enrichment.service";
import { ChatPolicyGuardService } from "./application/shared/chat-policy-guard.service";
import { ChatPostRunHooksService } from "./application/shared/chat-post-run-hooks.service";
import { ChatRunPersistenceService } from "./application/shared/chat-run-persistence.service";
import { ChartBiArtifactService } from "../delivery/chartbi/chartbi-artifact.service";
import { ChartBiResultProfiler } from "../delivery/chartbi/chartbi-result-profiler";
import { ChartBiIntentParser } from "../delivery/chartbi/chartbi-intent-parser";
import { ChartBiSpecCompiler } from "../delivery/chartbi/chartbi-spec-compiler";
import { ChartBiValidator } from "../delivery/chartbi/chartbi-validator";
import { ChartBiGroundingGuard } from "../delivery/chartbi/chartbi-grounding.guard";
import { Text2SqlModule } from "../text2sql/text2sql.module";
import { Text2SQLWorkflowRunner } from "../text2sql/text2sql-workflow-runner.service";
import { EnrichDeliveryStage } from "../text2sql/stages/enrich-delivery.stage";
import { PersistRunStage } from "../text2sql/stages/persist-run.stage";
import { PostRunHooksStage } from "../text2sql/stages/post-run-hooks.stage";
import { PrepareRunStage } from "../text2sql/stages/prepare-run.stage";
import { RunAgentGraphStage } from "../text2sql/stages/run-agent-graph.stage";
import { Text2SqlStreamEventMapper } from "../text2sql/stream/text2sql-stream-event.mapper";

@Module({
  imports: [
    AgentModule,
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
    DeliveryContractMapper,
    SandboxRuntimeService,
    SessionLifecycleUsecase,
    ExecuteMessageUsecase,
    StreamMessageUsecase,
    RunViewUsecase,
    SaveViewFromRunUsecase,
    ChatPostRunHooksService,
    ChatPolicyGuardService,
    ChatRunPersistenceService,
    ChatDeliveryEnrichmentService,
    Text2SQLWorkflowRunner,
    PrepareRunStage,
    RunAgentGraphStage,
    EnrichDeliveryStage,
    PersistRunStage,
    PostRunHooksStage,
    Text2SqlStreamEventMapper,
    ChartBiArtifactService,
    ChartBiResultProfiler,
    ChartBiIntentParser,
    ChartBiSpecCompiler,
    ChartBiValidator,
    ChartBiGroundingGuard
  ],
  exports: [ChatService]
})
export class ChatModule {}
