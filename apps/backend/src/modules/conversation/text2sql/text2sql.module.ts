import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { DatasourceModule } from "../../governance/datasource/datasource.module";
import { GovernanceAccessModule } from "../../governance/access/access.module";
import { KnowledgeModule } from "../../knowledge/knowledge.module";
import { ObservabilityModule } from "../../observability/observability.module";
import { PlatformDataPersistenceModule } from "../../platform/data/persistence.module";
import { DeliveryContractMapper } from "../delivery/delivery-contract.mapper";
import { ChartBiArtifactService } from "../delivery/chartbi/chartbi-artifact.service";
import { ChartBiGroundingGuard } from "../delivery/chartbi/chartbi-grounding.guard";
import { ChartBiIntentParser } from "../delivery/chartbi/chartbi-intent-parser";
import { ChartBiResultProfiler } from "../delivery/chartbi/chartbi-result-profiler";
import { ChartBiSpecCompiler } from "../delivery/chartbi/chartbi-spec-compiler";
import { ChartBiValidator } from "../delivery/chartbi/chartbi-validator";
import { SandboxRuntimeService } from "../delivery/sandbox/sandbox-runtime.service";
import { ChatDeliveryEnrichmentService } from "../chat/application/shared/chat-delivery-enrichment.service";
import { ChatPolicyGuardService } from "../chat/application/shared/chat-policy-guard.service";
import { ChatPostRunHooksService } from "../chat/application/shared/chat-post-run-hooks.service";
import { ChatRunPersistenceService } from "../chat/application/shared/chat-run-persistence.service";
import { Text2SQLWorkflowRunner } from "./text2sql-workflow-runner.service";
import { EnrichDeliveryStage } from "./stages/enrich-delivery.stage";
import { PersistRunStage } from "./stages/persist-run.stage";
import { PostRunHooksStage } from "./stages/post-run-hooks.stage";
import { PrepareRunStage } from "./stages/prepare-run.stage";
import { RunV2LangGraphStage } from "./stages/run-v2-langgraph.stage";
import { RunV2StateMachineStage } from "./stages/run-v2-state-machine.stage";
import { Text2SqlStreamEventMapper } from "./stream/text2sql-stream-event.mapper";

@Module({
  imports: [
    AgentModule,
    PlatformDataPersistenceModule,
    GovernanceAccessModule,
    DatasourceModule,
    ObservabilityModule,
    KnowledgeModule
  ],
  providers: [
    Text2SQLWorkflowRunner,
    PrepareRunStage,
    RunV2LangGraphStage,
    RunV2StateMachineStage,
    EnrichDeliveryStage,
    PersistRunStage,
    PostRunHooksStage,
    Text2SqlStreamEventMapper,
    ChatPolicyGuardService,
    ChatRunPersistenceService,
    ChatPostRunHooksService,
    ChatDeliveryEnrichmentService,
    DeliveryContractMapper,
    SandboxRuntimeService,
    ChartBiArtifactService,
    ChartBiResultProfiler,
    ChartBiIntentParser,
    ChartBiSpecCompiler,
    ChartBiValidator,
    ChartBiGroundingGuard
  ],
  exports: [Text2SQLWorkflowRunner, ChatDeliveryEnrichmentService]
})
export class Text2SqlModule {}
