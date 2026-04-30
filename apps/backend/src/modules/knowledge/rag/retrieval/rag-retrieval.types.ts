import type { RagChunkIndexEntryRecord } from "../../../rag/index/rag-index.repository";

export const RAG_RETRIEVAL_LANES = ["lexical", "dense", "graph"] as const;
export type RagRetrievalLane = (typeof RAG_RETRIEVAL_LANES)[number];

export interface RagBudgetSignal {
  tokenPressure?: number;
  latencyPressure?: number;
  costPressure?: number;
}

export interface RagRetrievalRequest {
  query: string;
  datasourceId: string;
  runId: string;
  workspaceId?: string;
  allowedTables?: string[];
  activeIndexVersionId?: string;
  perLaneLimit?: number;
  finalCandidateLimit?: number;
  laneTimeoutMs?: Partial<Record<RagRetrievalLane, number>>;
  laneArtificialDelayMs?: Partial<Record<RagRetrievalLane, number>>;
  budgetSignal?: RagBudgetSignal;
}

export interface RagRetrievalChunkMetadata {
  datasourceId: string;
  indexVersionId: string;
  chunkId: string;
  domain: string;
  assetFamily?: string;
  manifestFingerprint?: string;
  manifestEntryId?: string;
  sourceRef?: unknown;
  sourceVersion?: string;
  policyVersion?: string;
  modelingRevision?: number;
  visibilityScope?: string;
  preparationStatus?: string;
  reasonCodes?: string[];
  lifecycleState?: "retrieved" | "selected" | "pruned" | "filtered" | "unused";
  chunkProfile?: string;
  startOffset?: number;
  endOffset?: number;
  tableNames: string[];
  columnNames: string[];
  sourceMetadata?: Record<string, unknown>;
  denseProvider?: string;
  denseModel?: string;
  denseDimensions?: number;
  vectorVersion?: string;
  indexVersion?: string;
  scope?: string;
  assetType?: string;
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

export interface RagRerankStageMetadata {
  status: "ok" | "degraded" | "skipped";
  provider?: string;
  model?: string;
  mode?: "provider" | "mock";
  config_source?: "settings" | "env_fallback" | "missing";
  config_id?: string;
  timeout_ms?: number;
  input_count?: number;
  output_count?: number;
  fallback_reason?: string;
  unavailable_reason?: string;
  evidence_ids?: string[];
  timeoutMs?: number;
  inputCount?: number;
  outputCount?: number;
  fallbackReason?: string;
  unavailableReason?: string;
  configSource?: "settings" | "env_fallback" | "missing";
  configId?: string;
  evidenceIds?: string[];
}

export interface RagRerankMetadata {
  secondary: RagRerankStageMetadata;
  secondaryCompat?: RagRerankStageMetadata;
}

export interface RagContextPackLaneMetadata {
  lane:
    | RagRetrievalLane
    | "rerank"
    | "relationship"
    | "metric"
    | "example_sql"
    | "instruction"
    | "saved_prior_sql"
    | "schema_ddl_supplement"
    | "semantic_asset_family"
    | "dialect_function";
  state: "ready" | "degraded" | "unavailable" | "skipped";
  provider?: string;
  model?: string;
  input_count?: number;
  output_count?: number;
  selected_count?: number;
  timeout_ms?: number;
  unavailable_reason?: string;
  fallback_reason?: string;
  evidence_ids?: string[];
  reason_codes?: string[];
  inputCount?: number;
  outputCount?: number;
  selectedCount?: number;
  timeoutMs?: number;
  unavailableReason?: string;
  fallbackReason?: string;
  evidenceIds?: string[];
  reasonCodes?: string[];
}

export interface RagContextPackPruningDecision {
  budget_source: "retrieval_budget" | "rerank_budget" | "context_pack";
  removed_evidence_ids: string[];
  kept_evidence_ids: string[];
  reason_codes: string[];
  summary?: string;
  budgetSource?: "retrieval_budget" | "rerank_budget" | "context_pack";
  removedEvidenceIds?: string[];
  keptEvidenceIds?: string[];
  reasonCodes?: string[];
}

export interface RagSkillContextEntry {
  source: "skill_registry";
  domain: string;
  term: string;
  matched_by: "term" | "context";
}

export interface RagSkillContext {
  skills: Array<{
    key: string;
    name: string;
  }>;
  context: RagSkillContextEntry[];
  degrade_reason?: string;
}

export interface RagContextPackBindingSummary {
  model_keys: string[];
  relationship_keys: string[];
  metric_keys: string[];
  calculated_field_keys: string[];
  modelKeys?: string[];
  relationshipKeys?: string[];
  metricKeys?: string[];
  calculatedFieldKeys?: string[];
}

export interface RagContextPackInstructionSummary {
  model_bindings: string[];
  relationship_bindings: string[];
  metric_bindings: string[];
  calculated_field_bindings: string[];
  modelBindings?: string[];
  relationshipBindings?: string[];
  metricBindings?: string[];
  calculatedFieldBindings?: string[];
}

export interface RagContextPack {
  status: "ready" | "degraded";
  semantic_version?: number;
  modeling_revision?: number;
  semantic_lock_status: "locked" | "fallback" | "degraded";
  semantic_bindings: RagContextPackBindingSummary;
  instruction_sets: RagContextPackInstructionSummary;
  selected_context_summary: {
    count: number;
    snippets: string[];
    selectedContextCount?: number;
  };
  degrade_reasons: string[];
  risk_tags: string[];
  semanticVersion?: number;
  modelingRevision?: number;
  semanticLockStatus?: "locked" | "fallback" | "degraded";
  semanticBindings?: RagContextPackBindingSummary;
  instructionSets?: RagContextPackInstructionSummary;
  selectedContextSummary?: {
    count: number;
    snippets: string[];
  };
  lane_metadata?: RagContextPackLaneMetadata[];
  laneMetadata?: RagContextPackLaneMetadata[];
  pruning_decisions?: RagContextPackPruningDecision[];
  pruningDecisions?: RagContextPackPruningDecision[];
  selected_context_lanes?: string[];
  selectedContextLanes?: string[];
  degradeReasons?: string[];
  riskTags?: string[];
}

export interface RagPriorSqlLaneEvidence {
  status: "hit" | "miss" | "filtered" | "stale" | "ambiguous";
  matched_count: number;
  selected_count: number;
  filtered_count: number;
  stale_count?: number;
  ambiguous_count?: number;
  eligible_count?: number;
  degrade_reasons?: string[];
  shortcut?: RagPriorSqlShortcutDecision;
  matchedCount?: number;
  selectedCount?: number;
  filteredCount?: number;
  staleCount?: number;
  ambiguousCount?: number;
  eligibleCount?: number;
  degradeReasons?: string[];
  shortcutDecision?: RagPriorSqlShortcutDecision;
}

export interface RagPriorSqlShortcutDecision {
  status: "hit" | "miss" | "filtered" | "stale" | "ambiguous";
  reason_codes: string[];
  matched_count: number;
  eligible_count: number;
  filtered_count: number;
  stale_count: number;
  ambiguous_count: number;
  selected_chunk_id?: string;
  selected_view_id?: string;
  selected_source_run_id?: string;
  reasonCodes?: string[];
  matchedCount?: number;
  eligibleCount?: number;
  filteredCount?: number;
  staleCount?: number;
  ambiguousCount?: number;
  selectedChunkId?: string;
  selectedViewId?: string;
  selectedSourceRunId?: string;
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
  skill_context?: RagSkillContext;
  context_pack?: RagContextPack;
  prior_sql_lane?: RagPriorSqlLaneEvidence;
  priorSqlLane?: RagPriorSqlLaneEvidence;
  decision_reasons?: string[];
  rerank_metadata?: RagRerankMetadata;
  rerankMetadata?: RagRerankMetadata;
  lane_metadata?: RagContextPackLaneMetadata[];
  laneMetadata?: RagContextPackLaneMetadata[];
  pruning_decisions?: RagContextPackPruningDecision[];
  pruningDecisions?: RagContextPackPruningDecision[];
  permission_filtering?: {
    status?: "applied" | "skipped";
    denied_evidence_ids?: string[];
    denied_table_names?: string[];
    denied_column_names?: string[];
    reason_codes?: string[];
    kept_candidate_count?: number;
    deniedEvidenceIds?: string[];
    deniedTableNames?: string[];
    deniedColumnNames?: string[];
    reasonCodes?: string[];
    keptCandidateCount?: number;
  };
  permissionFiltering?: RagRetrievalBundle["permission_filtering"];
  two_pass_schema_recall?: {
    status?: "applied" | "skipped";
    selected_table_names?: string[];
    table_description_evidence_ids?: string[];
    supplemental_evidence_ids?: string[];
    supplemental_families?: string[];
    reason_codes?: string[];
    selectedTableNames?: string[];
    tableDescriptionEvidenceIds?: string[];
    supplementalEvidenceIds?: string[];
    supplementalFamilies?: string[];
    reasonCodes?: string[];
  };
  twoPassSchemaRecall?: RagRetrievalBundle["two_pass_schema_recall"];
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
  denseMetadata?: {
    provider?: string;
    model?: string;
    dimensions?: number;
    vectorVersion?: string;
    indexVersion?: string;
    scope?: string;
    assetType?: string;
  };
}

export interface RagRetrievalEntryContext {
  indexVersionId: string;
  entry: RagChunkIndexEntryRecord;
  parsedMetadata: RagRetrievalParsedMetadata;
}
