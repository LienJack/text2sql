import type {
  RagReplayRecord,
  RagRerankRequest,
  RagRerankResponse,
  RagRetrievalRequest,
  RagRetrievalResponse,
  WriteRagReplayInput
} from "./knowledge-rag-payload.contract";

export const KNOWLEDGE_RAG_CONTRACT = Symbol("KNOWLEDGE_RAG_CONTRACT");

export interface KnowledgeRagRetrievalContract {
  retrieve(input: RagRetrievalRequest): Promise<RagRetrievalResponse>;
}

export interface KnowledgeRagRerankContract {
  rerank(input: RagRerankRequest): Promise<RagRerankResponse>;
}

export interface KnowledgeRagReplayContract {
  writeReplay(input: WriteRagReplayInput): Promise<RagReplayRecord>;
  getReplay(runId: string, replayKey: string): Promise<RagReplayRecord | undefined>;
  listByRunId(runId: string): Promise<RagReplayRecord[]>;
}

export interface KnowledgeRagContract {
  retrieval: KnowledgeRagRetrievalContract;
  rerank: KnowledgeRagRerankContract;
  replay: KnowledgeRagReplayContract;
}
