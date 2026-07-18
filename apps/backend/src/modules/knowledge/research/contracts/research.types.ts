import type { AnalysisCompleteness } from "@text2sql/analysis-task-protocol";

export type ResearchQueryKind = "primary" | "counter_evidence";

export interface ResearchTimeBoundary {
  from?: string;
  to?: string;
  timezone?: string;
}

export interface ResearchConnectorConfigRecord {
  id: string;
  workspaceId: string;
  provider: "tavily";
  version: number;
  status: "active" | "superseded" | "disabled";
  baseUrl?: string | null;
  hasApiKey: boolean;
  apiKeyMasked?: string | null;
  configDigest: string;
  metadata: Record<string, unknown>;
  createdByActorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSourcePolicyRecord {
  id: string;
  workspaceId: string;
  connectorConfigId: string;
  version: number;
  status: "active" | "superseded" | "disabled";
  allowedDomains: string[];
  deniedDomains: string[];
  allowedQueryParams: string[];
  allowedMimeTypes: string[];
  maxRedirects: number;
  maxContentBytes: number;
  retentionDays: number;
  minIndependentSources: number;
  requireCounterEvidence: boolean;
  policyDigest: string;
  createdByActorId: string;
  effectiveAt: string;
  createdAt: string;
  updatedAt: string;
  connector: ResearchConnectorConfigRecord;
}

export interface ResearchBrief {
  version: "research-brief.v1";
  taskId: string;
  revisionId: string;
  workspaceId: string;
  question: string;
  decisionUse: string;
  timeBoundary?: ResearchTimeBoundary;
  policyId: string;
  policyDigest: string;
  connectorConfigId: string;
  connectorConfigDigest: string;
  queryBudget: number;
  resultBudget: number;
  extractBudget: number;
  contentByteBudget: number;
  minIndependentSources: number;
  requireCounterEvidence: boolean;
  stopConditions: string[];
}

export interface ResearchSearchCandidate {
  queryKind: ResearchQueryKind;
  title: string;
  url: string;
  publishedAt?: string;
  relevanceScore?: number;
}

export interface ResearchSearchResult {
  provider: "tavily";
  requestId: string;
  queryKind: ResearchQueryKind;
  candidates: ResearchSearchCandidate[];
  usageCredits?: number;
}

export interface ResearchExtractedSource {
  url: string;
  title?: string;
  content: string;
  mimeType: "text/markdown" | "text/plain";
}

export interface ResearchExtractResult {
  provider: "tavily";
  requestId: string;
  sources: ResearchExtractedSource[];
  failures: Array<{ reasonCode: string }>;
  usageCredits?: number;
}

export interface ResearchInjectionIndicator {
  category:
    | "instruction_override"
    | "tool_request"
    | "secret_request"
    | "scope_change";
  reasonCode: string;
}

export interface ResearchSourceSnapshotRecord {
  id: string;
  workspaceId: string;
  taskId: string;
  revisionId: string;
  policyId: string;
  connectorConfigId: string;
  provider: "tavily";
  providerRequestId?: string | null;
  canonicalUrl: string;
  locator: string;
  title?: string | null;
  mimeType: string;
  contentDigest: string;
  contentSizeBytes: number;
  completeness: AnalysisCompleteness;
  injectionIndicators: ResearchInjectionIndicator[];
  providerMetadata: Record<string, unknown>;
  publishedAt?: string | null;
  retrievedAt: string;
  retentionExpiresAt: string;
}

export interface ResearchCoverageObligation {
  id: "source_count" | "independence" | "time_coverage" | "counter_evidence";
  status: "passed" | "failed" | "unknown";
  reasonCodes: string[];
  sourceRefs: string[];
}

export interface ResearchCoverageResult {
  version: "research-coverage.v1";
  status: "complete" | "partial" | "conflicted" | "insufficient";
  obligations: ResearchCoverageObligation[];
  sourceRefs: string[];
  rejectionReasonCodes: string[];
  stopReason:
    | "coverage_closed"
    | "budget_exhausted"
    | "source_exhausted"
    | "provider_unavailable";
}

export interface ResearchRunResult {
  brief: ResearchBrief;
  snapshots: ResearchSourceSnapshotRecord[];
  coverage: ResearchCoverageResult;
  providerRequestIds: string[];
  queryCount: number;
  searchCount: number;
  artifactBytes: number;
}
