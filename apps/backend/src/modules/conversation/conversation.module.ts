import { Module } from "@nestjs/common";
import { AgentModule } from "./agent/agent.module";
import { ChatModule } from "./chat/chat.module";
import { AnalysisModule } from "./analysis/analysis.module";

@Module({
  imports: [AgentModule, ChatModule, AnalysisModule],
  exports: [AgentModule, ChatModule, AnalysisModule]
})
export class ConversationModule {}
