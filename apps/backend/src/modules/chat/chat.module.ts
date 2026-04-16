import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { DataModule } from "../data/data.module";
import { DatasourceModule } from "../datasource/datasource.module";
import { LlmModule } from "../llm/llm.module";
import { ObservabilityModule } from "../observability/observability.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [AgentModule, DataModule, DatasourceModule, LlmModule, ObservabilityModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService]
})
export class ChatModule {}
