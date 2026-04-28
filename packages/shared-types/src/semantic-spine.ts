export type SemanticSpineScope = "global" | "datasource";
export type SemanticSpineVersionStatus = "active" | "deprecated";
export type SemanticSpineResolveStatus = "ready" | "degraded";
export type SemanticSpineRelationshipCardinality =
  | "one_to_one"
  | "one_to_many"
  | "many_to_one"
  | "many_to_many";
export type SemanticSpineMetricAggregation =
  | "sum"
  | "count"
  | "avg"
  | "min"
  | "max"
  | "count_distinct"
  | "custom";

export interface SemanticSpineScopeRef {
  scope: SemanticSpineScope;
  scopeKey: string;
  datasourceId?: string | null;
}

export interface SemanticSpineModelColumn {
  name: string;
  dataType?: string;
  expression?: string;
  description?: string;
}

export interface SemanticSpineModel {
  name: string;
  table: string;
  description?: string;
  primaryKey?: string[];
  columns?: SemanticSpineModelColumn[];
}

export interface SemanticSpineRelationship {
  name: string;
  fromModel: string;
  toModel: string;
  cardinality: SemanticSpineRelationshipCardinality;
  joinCondition: string;
  description?: string;
}

export interface SemanticSpineMetric {
  name: string;
  model: string;
  expression: string;
  aggregation: SemanticSpineMetricAggregation;
  description?: string;
}

export interface SemanticSpineCalculatedField {
  name: string;
  model: string;
  expression: string;
  dataType?: string;
  description?: string;
}

export interface SemanticSpineSnapshot {
  models: SemanticSpineModel[];
  relationships: SemanticSpineRelationship[];
  metrics: SemanticSpineMetric[];
  calculatedFields: SemanticSpineCalculatedField[];
  metadata?: Record<string, unknown>;
}

export interface PublishSemanticSpineVersionRequest extends SemanticSpineScopeRef {
  domain: string;
  semanticVersion?: number;
  releaseSummary: string;
  auditSummary: string;
  snapshot: SemanticSpineSnapshot;
  riskTags?: string[];
  publishedByRunId?: string;
  activatedByRunId?: string;
  activatedAt?: string;
  status?: SemanticSpineVersionStatus;
}

export interface SemanticSpineVersionRecord extends SemanticSpineScopeRef {
  id: string;
  domain: string;
  semanticVersion: number;
  status: SemanticSpineVersionStatus;
  releaseSummary: string;
  auditSummary: string;
  snapshot: SemanticSpineSnapshot;
  riskTags: string[];
  publishedByRunId?: string;
  activatedByRunId?: string;
  activatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticSpineVersionLookupRequest {
  domain: string;
  semanticVersion?: number;
  datasourceId?: string;
}

export interface SemanticSpineVersionLookupResponse {
  status: SemanticSpineResolveStatus;
  version?: SemanticSpineVersionRecord;
  degradeReason?: string;
  riskTags: string[];
  matchedScope?: SemanticSpineScope;
}
