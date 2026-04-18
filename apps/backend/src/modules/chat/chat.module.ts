import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { DataModule } from "../data/data.module";
import { DatasourceModule } from "../datasource/datasource.module";
import { LlmModule } from "../llm/llm.module";
import { ObservabilityModule } from "../observability/observability.module";
import { RagModule } from "../rag/rag.module";
import { DeliveryContractMapper } from "../delivery/delivery-contract.mapper";
import { SandboxRuntimeService } from "../delivery/sandbox/sandbox-runtime.service";
import { MemoryModule } from "../memory/memory.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [
    AgentModule,
    DataModule,
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
