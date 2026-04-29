import { Test } from "@nestjs/testing";
import {
  KNOWLEDGE_FACADE_CONTRACT,
  type KnowledgeFacadeContract
} from "../../src/modules/knowledge/contracts/knowledge-facade.contract";
import {
  KNOWLEDGE_GLOSSARY_CONTRACT,
  type KnowledgeGlossaryContract
} from "../../src/modules/knowledge/contracts/knowledge-glossary.contract";
import {
  KNOWLEDGE_MEMORY_CONTRACT,
  type KnowledgeMemoryContract
} from "../../src/modules/knowledge/contracts/knowledge-memory.contract";
import {
  KNOWLEDGE_RAG_CONTRACT,
  type KnowledgeRagContract
} from "../../src/modules/knowledge/contracts/knowledge-rag.contract";
import {
  KNOWLEDGE_SEMANTIC_REGISTRY_CONTRACT,
  type KnowledgeSemanticRegistryContract
} from "../../src/modules/knowledge/contracts/knowledge-semantic-registry.contract";
import { KnowledgeChatSupportFacade } from "../../src/modules/knowledge/knowledge-chat-support.facade";
import { KnowledgeModule } from "../../src/modules/knowledge/knowledge.module";
import { RagModule as LegacyRagModule } from "../../src/modules/rag/rag.module";
import { RagRetrievalService as KnowledgeRagRetrievalService } from "../../src/modules/knowledge/rag/retrieval/rag-retrieval.service";
import { RagRerankService as KnowledgeRagRerankService } from "../../src/modules/knowledge/rag/rerank/rag-rerank.service";
import { RagRetrievalService as LegacyRagRetrievalService } from "../../src/modules/rag/retrieval/rag-retrieval.service";
import { RagRerankService as LegacyRagRerankService } from "../../src/modules/rag/rerank/rag-rerank.service";

describe("KnowledgeModule contract providers", () => {
  it("exports facade + capability contract tokens", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [KnowledgeModule]
    }).compile();

    const facade = moduleRef.get(KnowledgeChatSupportFacade, {
      strict: false
    });
    const facadeContract = moduleRef.get<KnowledgeFacadeContract>(
      KNOWLEDGE_FACADE_CONTRACT,
      { strict: false }
    );
    const ragContract = moduleRef.get<KnowledgeRagContract>(KNOWLEDGE_RAG_CONTRACT, {
      strict: false
    });
    const glossaryContract = moduleRef.get<KnowledgeGlossaryContract>(
      KNOWLEDGE_GLOSSARY_CONTRACT,
      { strict: false }
    );
    const semanticContract = moduleRef.get<KnowledgeSemanticRegistryContract>(
      KNOWLEDGE_SEMANTIC_REGISTRY_CONTRACT,
      { strict: false }
    );
    const memoryContract = moduleRef.get<KnowledgeMemoryContract>(
      KNOWLEDGE_MEMORY_CONTRACT,
      { strict: false }
    );

    expect(facade).toBeDefined();
    expect(facadeContract).toBeDefined();
    expect(facadeContract).toBe(facade);
    expect(ragContract.retrieval).toBe(facadeContract.rag.retrieval);
    expect(ragContract.rerank).toBe(facadeContract.rag.rerank);
    expect(ragContract.replay).toBe(facadeContract.rag.replay);
    expect(glossaryContract.terms).toBe(facadeContract.glossary.terms);
    expect(semanticContract.registry).toBe(facadeContract.semanticRegistry.registry);
    expect(memoryContract.promotion).toBe(facadeContract.memory.promotion);
  });

  it("resolves legacy rag tokens to canonical knowledge implementations", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LegacyRagModule]
    }).compile();

    const legacyRetrieval = moduleRef.get(LegacyRagRetrievalService, {
      strict: false
    });
    const canonicalRetrieval = moduleRef.get(KnowledgeRagRetrievalService, {
      strict: false
    });
    const legacyRerank = moduleRef.get(LegacyRagRerankService, {
      strict: false
    });
    const canonicalRerank = moduleRef.get(KnowledgeRagRerankService, {
      strict: false
    });

    expect(canonicalRetrieval).toBeDefined();
    expect(canonicalRerank).toBeDefined();
    expect(legacyRetrieval).toBe(canonicalRetrieval);
    expect(legacyRerank).toBe(canonicalRerank);
  });
});
