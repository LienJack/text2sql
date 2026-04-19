import { Module } from "@nestjs/common";
import { AgentModule } from "./agent/agent.module";
import { ChatModule } from "./chat/chat.module";

@Module({
  imports: [AgentModule, ChatModule],
  exports: [AgentModule, ChatModule]
})
export class ConversationModule {}
