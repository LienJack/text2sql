export const SEMANTIC_SPINE_SNAPSHOT_NOT_FOUND_REASON =
  "semantic_spine_snapshot_not_found";
export const SEMANTIC_SPINE_SNAPSHOT_INVALID_REASON =
  "semantic_spine_snapshot_invalid";
export const SEMANTIC_SPINE_DEGRADED_RISK_TAG = "semantic_spine_degraded";

export type SemanticSpineSnapshotStatus = "active" | "deprecated";

export interface SemanticSpineModelDefinition {
  key: string;
  name: string;
  binding: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticSpineRelationshipDefinition {
  key: string;
  name: string;
  fromModel: string;
  toModel: string;
  relationshipType?: string;
  condition?: string;
  cardinality?: "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";
  joinConditionEvidenceRefs?: string[];
  binding?: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticSpineMetricDefinition {
  key: string;
  name: string;
  model: string;
  expression?: string;
  aggregation?: string;
  grain?: string;
  unit?: string;
  timezone?: string;
  additivity?: "additive" | "semi_additive" | "non_additive";
  nullPolicy?: "exclude" | "zero" | "preserve";
  currency?: string;
  binding: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticSpineCalculatedFieldDefinition {
  key: string;
  name: string;
  model: string;
  expression?: string;
  dataType?: string;
  binding: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface SemanticSpineSnapshotDocument {
  models: SemanticSpineModelDefinition[];
  relationships: SemanticSpineRelationshipDefinition[];
  metrics: SemanticSpineMetricDefinition[];
  calculatedFields?: SemanticSpineCalculatedFieldDefinition[];
  calculated_fields?: SemanticSpineCalculatedFieldDefinition[];
  metadata?: Record<string, unknown>;
}

export interface PublishSemanticSpineSnapshotInput {
  domain: string;
  semanticVersion?: number;
  status?: SemanticSpineSnapshotStatus;
  releaseSummary: string;
  auditSummary: string;
  riskTags?: string[];
  snapshot: SemanticSpineSnapshotDocument;
  checksum?: string;
  publishedByRunId?: string;
  activatedByRunId?: string;
  activatedAt?: string;
}

export interface SemanticSpineSnapshotRecord {
  id: string;
  domain: string;
  semanticVersion: number;
  status: SemanticSpineSnapshotStatus;
  releaseSummary: string;
  auditSummary: string;
  riskTags: string[];
  snapshot: SemanticSpineSnapshotDocument;
  checksum?: string;
  publishedByRunId?: string;
  activatedByRunId?: string;
  activatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticSpineSnapshotLookupInput {
  domain: string;
  semanticVersion?: number;
  datasourceId?: string;
}

export interface SemanticSpineSnapshotLookupResult {
  status: "ready" | "degraded";
  semantic_version?: number;
  snapshot?: SemanticSpineSnapshotDocument;
  release_summary?: string;
  audit_summary?: string;
  checksum?: string;
  published_by_run_id?: string;
  activated_by_run_id?: string;
  activated_at?: string;
  degrade_reason?: string;
  risk_tags: string[];
  matched_scope?: "datasource" | "global";
  matched_domain?: string;
}
