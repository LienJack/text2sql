import type { SemanticAssetReasonCode } from "./semantic-asset-reason-codes";
import type { SemanticAssetSourceSnapshot } from "./semantic-asset-source-snapshot.types";

export const SEMANTIC_ASSET_MANIFEST_VERSION = "semantic-asset-manifest/v1" as const;

export const SEMANTIC_ASSET_FAMILIES = [
  "table_description",
  "full_schema",
  "column_batch",
  "relationship_binding",
  "metric",
  "calculated_field",
  "business_term",
  "prompt_instruction",
  "prior_question_sql",
  "dialect_rule",
  "project_metadata"
] as const;

export type SemanticAssetFamily = (typeof SEMANTIC_ASSET_FAMILIES)[number];

export type SemanticAssetPreparationStatus = "prepared" | "skipped" | "degraded";

export type SemanticAssetVisibilityScope =
  | "workspace"
  | "datasource"
  | "table_permissions"
  | "public";

export type SemanticAssetPreparationTrigger =
  | "schema"
  | "modeling_revision"
  | "examples"
  | "instructions"
  | "prior_sql"
  | "embedding_model";

export interface SemanticAssetEmbeddingProfile {
  provider: string;
  model: string;
  dimensions?: number;
  vectorVersion: string;
  configSource: "settings" | "env_fallback" | "missing";
}

export interface SemanticAssetSourceRef {
  type: string;
  ref: string;
}

export interface SemanticAssetManifestEntry {
  id: string;
  family: SemanticAssetFamily;
  sourceRef: SemanticAssetSourceRef;
  sourceVersion: string;
  sourceHash?: string;
  workspaceId?: string;
  datasourceId: string;
  policyVersion?: string;
  modelingRevision?: number;
  visibilityScope: SemanticAssetVisibilityScope;
  enabled: boolean;
  status: SemanticAssetPreparationStatus;
  reasonCodes: SemanticAssetReasonCode[];
  summary: Record<string, unknown>;
  generatedChunkRefs: string[];
}

export interface SemanticAssetManifest {
  manifestVersion: typeof SEMANTIC_ASSET_MANIFEST_VERSION;
  fingerprint: string;
  datasourceId: string;
  workspaceId?: string;
  embeddingProfile: SemanticAssetEmbeddingProfile;
  sourceSnapshotSummary: {
    triggers: SemanticAssetPreparationTrigger[];
    modelingRevision?: number;
    sourceVersion?: string;
    sourceHash?: string;
  };
  entries: SemanticAssetManifestEntry[];
  familyCounts: Partial<Record<SemanticAssetFamily, number>>;
  reasonCodes: SemanticAssetReasonCode[];
}

export interface SemanticAssetManifestSummary {
  manifestVersion: typeof SEMANTIC_ASSET_MANIFEST_VERSION;
  fingerprint: string;
  datasourceId: string;
  workspaceId?: string;
  embeddingProfile: SemanticAssetEmbeddingProfile;
  sourceSnapshotSummary: SemanticAssetManifest["sourceSnapshotSummary"];
  familyCounts: Partial<Record<SemanticAssetFamily, number>>;
  reasonCodes: SemanticAssetReasonCode[];
  entryCount: number;
  preparedEntryCount: number;
  skippedEntryCount: number;
  degradedEntryCount: number;
}

export type { SemanticAssetSourceSnapshot };
