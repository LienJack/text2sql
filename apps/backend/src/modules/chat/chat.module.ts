import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { DataModule } from "../data/data.module";
import { ObservabilityModule } from "../observability/observability.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [AgentModule, DataModule, ObservabilityModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService]
})
export class ChatModule {}

