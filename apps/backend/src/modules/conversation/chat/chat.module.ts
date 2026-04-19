import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { PlatformDataModule } from "../../platform/data/data.module";
import { DatasourceModule } from "../../governance/datasource/datasource.module";
import { LlmModule } from "../../llm/llm.module";
import { ObservabilityModule } from "../../observability/observability.module";
import { RagModule } from "../../knowledge/rag/rag.module";
import { DeliveryContractMapper } from "../delivery/delivery-contract.mapper";
import { SandboxRuntimeService } from "../delivery/sandbox/sandbox-runtime.service";
import { MemoryModule } from "../../knowledge/memory/memory.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [
    AgentModule,
    PlatformDataModule,
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
