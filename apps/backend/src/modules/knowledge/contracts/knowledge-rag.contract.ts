import type { RagReplayRepository } from "../rag/observability/rag-replay.repository";
import type { RagRetrievalService } from "../rag/retrieval/rag-retrieval.service";
import type { RagRerankService } from "../rag/rerank/rag-rerank.service";

export const KNOWLEDGE_RAG_CONTRACT = Symbol("KNOWLEDGE_RAG_CONTRACT");

export interface KnowledgeRagContract {
  retrieval: Pick<RagRetrievalService, "retrieve">;
  rerank: Pick<RagRerankService, "rerank">;
  replay: Pick<RagReplayRepository, "writeReplay" | "getReplay" | "listByRunId">;
}
