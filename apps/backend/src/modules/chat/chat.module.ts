import { Module } from "@nestjs/common";
import { AgentModule } from "../conversation/agent/agent.module";
import { PlatformDataPersistenceModule } from "../platform/data/persistence.module";
import { DatasourceModule } from "../governance/datasource/datasource.module";
import { GovernanceAccessModule } from "../governance/access/access.module";
import { LlmModule } from "../llm/llm.module";
import { ObservabilityModule } from "../observability/observability.module";
import { RagModule } from "../rag/rag.module";
import { DeliveryContractMapper } from "../conversation/delivery/delivery-contract.mapper";
import { SandboxRuntimeService } from "../conversation/delivery/sandbox/sandbox-runtime.service";
import { MemoryModule } from "../memory/memory.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [
    AgentModule,
    PlatformDataPersistenceModule,
    GovernanceAccessModule,
    DatasourceModule,
    LlmModule,
    ObservabilityModule,
    RagModule,
    MemoryModule
  ],
  controllers: [ChatController],
  providers: [ChatService, DeliveryContractMapper, SandboxRuntimeService],
  exports: [ChatService]
})
export class ChatModule {}
