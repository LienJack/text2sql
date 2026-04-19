import { Module } from "@nestjs/common";
import { GlossaryModule } from "./glossary/glossary.module";
import { MemoryModule } from "./memory/memory.module";
import { RagModule } from "./rag/rag.module";
import { SemanticRegistryModule } from "./semantic-registry/semantic-registry.module";

@Module({
  imports: [RagModule, SemanticRegistryModule, GlossaryModule, MemoryModule],
  exports: [RagModule, SemanticRegistryModule, GlossaryModule, MemoryModule]
})
export class KnowledgeModule {}
