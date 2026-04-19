import { Module } from "@nestjs/common";
import { GlossaryModule } from "./glossary/glossary.module";
import { KnowledgeChatSupportFacade } from "./knowledge-chat-support.facade";
import { MemoryModule } from "./memory/memory.module";
import { RagModule } from "./rag/rag.module";
import { SemanticRegistryModule } from "./semantic-registry/semantic-registry.module";

@Module({
  imports: [RagModule, SemanticRegistryModule, GlossaryModule, MemoryModule],
  providers: [KnowledgeChatSupportFacade],
  exports: [
    KnowledgeChatSupportFacade,
    RagModule,
    SemanticRegistryModule,
    GlossaryModule,
    MemoryModule
  ]
})
export class KnowledgeModule {}
