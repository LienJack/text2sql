import { Module } from "@nestjs/common";
import { ConversationModule } from "./modules/conversation/conversation.module";
import { GovernanceModule } from "./modules/governance/governance.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { PlatformModule } from "./modules/platform/platform.module";

@Module({
  imports: [PlatformModule, GovernanceModule, KnowledgeModule, ConversationModule]
})
export class AppModule {}
