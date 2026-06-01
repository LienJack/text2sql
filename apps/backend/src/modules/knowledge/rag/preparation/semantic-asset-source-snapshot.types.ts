import type {
  SemanticAssetFamily,
  SemanticAssetPreparationStatus,
  SemanticAssetPreparationTrigger,
  SemanticAssetSourceRef,
  SemanticAssetVisibilityScope
} from "./semantic-asset-manifest.types";
import type { SemanticAssetReasonCode } from "./semantic-asset-reason-codes";

export type SemanticAssetSourceSnapshotKind =
  | "datasource_schema"
  | "modeling_graph"
  | "glossary_term"
  | "prompt_instruction"
  | "saved_prior_sql"
  | "dialect_metadata"
  | "project_metadata"
  | "correction_feedback";

export interface SemanticAssetColumnSnapshot {
  name: string;
  type?: string;
  description?: string;
}

export interface SemanticAssetRelationshipSnapshot {
  name?: string;
  fromTable: string;
  fromColumn?: string;
  toTable: string;
  toColumn?: string;
  joinType?: string;
  description?: string;
}

export interface SemanticAssetSourceSnapshot {
  trigger?: SemanticAssetPreparationTrigger;
  sourceKind?: SemanticAssetSourceSnapshotKind;
  family?: SemanticAssetFamily;
  sourceRef?: SemanticAssetSourceRef;
  sourceVersion?: string;
  sourceHash?: string;
  policyVersion?: string;
  modelingRevision?: number;
  visibilityScope?: SemanticAssetVisibilityScope;
  enabled?: boolean;
  status?: SemanticAssetPreparationStatus;
  reasonCodes?: SemanticAssetReasonCode[];
  summary?: Record<string, unknown>;
  generatedChunkRefs?: string[];
  title?: string;
  content?: string;
  tableName?: string;
  columnName?: string;
  columns?: SemanticAssetColumnSnapshot[];
  relationships?: SemanticAssetRelationshipSnapshot[];
  term?: string;
  definition?: string;
  synonyms?: string[];
  question?: string;
  sql?: string;
  rationale?: string;
  scene?: string;
  scope?: string;
  instructionSummary?: string;
  dialect?: string;
  rules?: string[];
  projectName?: string;
  workspaceId?: string;
  datasourceId?: string;
  tableNames?: string[];
  columnNames?: string[];
  trusted?: boolean;
  verified?: boolean;
  promoted?: boolean;
  runtimeEligible?: boolean;
  viewId?: string;
  viewName?: string;
  viewStatus?: string;
  compatibilitySignals?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SemanticAssetExcludedSourceSnapshot {
  snapshot: SemanticAssetSourceSnapshot;
  reasonCodes: SemanticAssetReasonCode[];
}
