import { Module } from "@nestjs/common";
import {
  KNOWLEDGE_FACADE_CONTRACT,
  type KnowledgeFacadeContract
} from "./contracts/knowledge-facade.contract";
import {
  KNOWLEDGE_GLOSSARY_CONTRACT,
  type KnowledgeGlossaryContract
} from "./contracts/knowledge-glossary.contract";
import {
  KNOWLEDGE_MEMORY_CONTRACT,
  type KnowledgeMemoryContract
} from "./contracts/knowledge-memory.contract";
import {
  KNOWLEDGE_RAG_CONTRACT,
  type KnowledgeRagContract
} from "./contracts/knowledge-rag.contract";
import {
  KNOWLEDGE_SEMANTIC_REGISTRY_CONTRACT,
  type KnowledgeSemanticRegistryContract
} from "./contracts/knowledge-semantic-registry.contract";
import { GlossaryModule } from "./glossary/glossary.module";
import { KnowledgeChatSupportFacade } from "./knowledge-chat-support.facade";
import { MemoryModule } from "./memory/memory.module";
import { RagModule } from "./rag/rag.module";
import { SemanticSpineModule } from "./semantic-spine/semantic-spine.module";
import { SemanticRegistryModule } from "./semantic-registry/semantic-registry.module";

@Module({
  imports: [
    RagModule,
    SemanticRegistryModule,
    SemanticSpineModule,
    GlossaryModule,
    MemoryModule
  ],
  providers: [
    KnowledgeChatSupportFacade,
    {
      provide: KNOWLEDGE_FACADE_CONTRACT,
      useExisting: KnowledgeChatSupportFacade
    },
    {
      provide: KNOWLEDGE_RAG_CONTRACT,
      useFactory: (
        facade: KnowledgeFacadeContract
      ): KnowledgeRagContract => facade.rag,
      inject: [KNOWLEDGE_FACADE_CONTRACT]
    },
    {
      provide: KNOWLEDGE_GLOSSARY_CONTRACT,
      useFactory: (
        facade: KnowledgeFacadeContract
      ): KnowledgeGlossaryContract => facade.glossary,
      inject: [KNOWLEDGE_FACADE_CONTRACT]
    },
    {
      provide: KNOWLEDGE_SEMANTIC_REGISTRY_CONTRACT,
      useFactory: (
        facade: KnowledgeFacadeContract
      ): KnowledgeSemanticRegistryContract => facade.semanticRegistry,
      inject: [KNOWLEDGE_FACADE_CONTRACT]
    },
    {
      provide: KNOWLEDGE_MEMORY_CONTRACT,
      useFactory: (
        facade: KnowledgeFacadeContract
      ): KnowledgeMemoryContract => facade.memory,
      inject: [KNOWLEDGE_FACADE_CONTRACT]
    }
  ],
  exports: [
    KnowledgeChatSupportFacade,
    KNOWLEDGE_FACADE_CONTRACT,
    KNOWLEDGE_RAG_CONTRACT,
    KNOWLEDGE_GLOSSARY_CONTRACT,
    KNOWLEDGE_SEMANTIC_REGISTRY_CONTRACT,
    KNOWLEDGE_MEMORY_CONTRACT,
    SemanticSpineModule
  ]
})
export class KnowledgeModule {}
