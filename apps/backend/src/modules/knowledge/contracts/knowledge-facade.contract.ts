import type { KnowledgeGlossaryContract } from "./knowledge-glossary.contract";
import type { KnowledgeMemoryContract } from "./knowledge-memory.contract";
import type { KnowledgeRagContract } from "./knowledge-rag.contract";
import type { KnowledgeSemanticRegistryContract } from "./knowledge-semantic-registry.contract";

export const KNOWLEDGE_FACADE_CONTRACT = Symbol("KNOWLEDGE_FACADE_CONTRACT");

export interface KnowledgeFacadeContract {
  rag: KnowledgeRagContract;
  glossary: KnowledgeGlossaryContract;
  semanticRegistry: KnowledgeSemanticRegistryContract;
  memory: KnowledgeMemoryContract;
}
