import { Inject, Injectable, Optional } from "@nestjs/common";
import { GlossaryService } from "../glossary/glossary.service";
import type { KnowledgeFacadeContract } from "./contracts/knowledge-facade.contract";
import type { KnowledgeGlossaryContract } from "./contracts/knowledge-glossary.contract";
import type { KnowledgeMemoryContract } from "./contracts/knowledge-memory.contract";
import type { KnowledgeRagContract } from "./contracts/knowledge-rag.contract";
import {
  KNOWLEDGE_SEMANTIC_SPINE_COMPILER_CONTRACT,
  KNOWLEDGE_SEMANTIC_SPINE_CONTEXT_PACK_MAPPER_CONTRACT,
  type KnowledgeSemanticRegistryContract,
  type KnowledgeSemanticSpineCompilerContract,
  type KnowledgeSemanticSpineContextPackMapperContract,
  type KnowledgeSemanticSpineContract
} from "./contracts/knowledge-semantic-registry.contract";
import { MemoryPromotionService } from "./memory/memory-promotion.service";
import { RagReplayRepository } from "./rag/observability/rag-replay.repository";
import { RagRetrievalService } from "./rag/retrieval/rag-retrieval.service";
import { RagRerankService } from "./rag/rerank/rag-rerank.service";
import { SemanticSpineRepository } from "./semantic-spine/semantic-spine.repository";
import { SemanticRegistryService } from "./semantic-registry/semantic-registry.service";

@Injectable()
export class KnowledgeChatSupportFacade implements KnowledgeFacadeContract {
  private readonly ragContract: KnowledgeRagContract;
  private readonly glossaryContract: KnowledgeGlossaryContract;
  private readonly semanticRegistryContract: KnowledgeSemanticRegistryContract;
  private readonly memoryContract: KnowledgeMemoryContract;

  constructor(
    readonly memoryPromotionService: MemoryPromotionService,
    readonly ragReplayRepository: RagReplayRepository,
    readonly ragRetrievalService: RagRetrievalService,
    readonly ragRerankService: RagRerankService,
    readonly glossaryService: GlossaryService,
    readonly semanticRegistryService: SemanticRegistryService,
    readonly semanticSpineRepository: SemanticSpineRepository,
    @Optional()
    @Inject(KNOWLEDGE_SEMANTIC_SPINE_COMPILER_CONTRACT)
    readonly semanticSpineCompiler?: KnowledgeSemanticSpineCompilerContract,
    @Optional()
    @Inject(KNOWLEDGE_SEMANTIC_SPINE_CONTEXT_PACK_MAPPER_CONTRACT)
    readonly semanticSpineContextPackMapper?: KnowledgeSemanticSpineContextPackMapperContract
  ) {
    this.ragContract = {
      retrieval: this.ragRetrievalService,
      rerank: this.ragRerankService,
      replay: this.ragReplayRepository
    };
    this.glossaryContract = {
      terms: this.glossaryService
    };
    const semanticSpineContract: KnowledgeSemanticSpineContract = {
      repository: this.semanticSpineRepository
    };
    if (this.semanticSpineCompiler) {
      semanticSpineContract.compiler = this.semanticSpineCompiler;
    }
    if (this.semanticSpineContextPackMapper) {
      semanticSpineContract.mapper = this.semanticSpineContextPackMapper;
    }
    this.semanticRegistryContract = {
      registry: this.semanticRegistryService,
      semanticSpine: semanticSpineContract
    };
    this.memoryContract = {
      promotion: this.memoryPromotionService
    };
  }

  get rag(): KnowledgeRagContract {
    return this.ragContract;
  }

  get glossary(): KnowledgeGlossaryContract {
    return this.glossaryContract;
  }

  get semanticRegistry(): KnowledgeSemanticRegistryContract {
    return this.semanticRegistryContract;
  }

  get memory(): KnowledgeMemoryContract {
    return this.memoryContract;
  }
}
