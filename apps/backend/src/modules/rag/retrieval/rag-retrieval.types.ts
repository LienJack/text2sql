import type { RagChunkIndexEntryRecord } from "../index/rag-index.repository";

export const RAG_RETRIEVAL_LANES = ["lexical", "dense", "graph"] as const;
export type RagRetrievalLane = (typeof RAG_RETRIEVAL_LANES)[number];

export interface RagRetrievalRequest {
  query: string;
  datasourceId: string;
  runId: string;
  activeIndexVersionId?: string;
  perLaneLimit?: number;
  finalCandidateLimit?: number;
  laneTimeoutMs?: Partial<Record<RagRetrievalLane, number>>;
  laneArtificialDelayMs?: Partial<Record<RagRetrievalLane, number>>;
}

export interface RagRetrievalChunkMetadata {
  datasourceId: string;
  indexVersionId: string;
  chunkId: string;
  domain: string;
  chunkProfile?: string;
  startOffset?: number;
  endOffset?: number;
  tableNames: string[];
  columnNames: string[];
  sourceMetadata?: Record<string, unknown>;
}

export interface RagRetrievalChunkPayload {
  chunk_id: string;
  content: string;
  metadata: RagRetrievalChunkMetadata;
}

export interface RagRetrievalLaneHit {
  lane: RagRetrievalLane;
  chunk_id: string;
  score: number;
  evidence: string[];
  chunk: RagRetrievalChunkPayload;
}

export interface RagRetrievalLaneResult {
  lane: RagRetrievalLane;
  status: "ok" | "degraded";
  timeout_ms: number;
  elapsed_ms: number;
  degrade_reason?: string;
  hits: RagRetrievalLaneHit[];
}

export interface RagRetrievalCandidate {
  chunk_id: string;
  source_lane: RagRetrievalLane;
  evidence: string[];
  score: number;
  lane_scores: Partial<Record<RagRetrievalLane, number>>;
  lane_ranks: Partial<Record<RagRetrievalLane, number>>;
  chunk: RagRetrievalChunkPayload;
}

export interface RagRerankedCandidate extends RagRetrievalCandidate {
  primary_score: number;
  secondary_score?: number;
  final_score: number;
  rank_reason: string[];
}

export interface RagRetrievalBundle {
  query: string;
  run_id: string;
  datasource_id: string;
  index_version_id?: string;
  status: "ready" | "degraded";
  degrade_reasons: string[];
  lane_results: Record<RagRetrievalLane, RagRetrievalLaneResult>;
  candidates: RagRetrievalCandidate[];
  reranked?: RagRerankedCandidate[];
  selected_context?: RagRetrievalChunkPayload[];
  risk_tags?: string[];
}

export interface RagRetrievalResponse {
  retrieval_bundle: RagRetrievalBundle;
}

export interface RagRetrievalParsedMetadata extends Record<string, unknown> {
  sourceMetadata: Record<string, unknown>;
  tableNames: string[];
  columnNames: string[];
  chunkProfile?: string;
  startOffset?: number;
  endOffset?: number;
}

export interface RagRetrievalEntryContext {
  indexVersionId: string;
  entry: RagChunkIndexEntryRecord;
  parsedMetadata: RagRetrievalParsedMetadata;
}
