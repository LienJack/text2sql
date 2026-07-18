export const ANALYSIS_TASK_PROTOCOL_ID = "analysis-task-protocol" as const;
export const ANALYSIS_TASK_PROTOCOL_VERSION = "1.0.0" as const;

export const ANALYSIS_TASK_TERMINAL_STATUSES = [
  "completed",
  "partial",
  "cancelled",
  "failed"
] as const;

export type AnalysisTaskTerminalStatus =
  (typeof ANALYSIS_TASK_TERMINAL_STATUSES)[number];

export type AnalysisTaskStatus =
  | "draft"
  | "queued"
  | "running"
  | "waiting_for_human"
  | "pausing"
  | "paused"
  | "cancelling"
  | AnalysisTaskTerminalStatus;

export type AnalysisAttemptStatus =
  | "queued"
  | "running"
  | "waiting_for_human"
  | "paused"
  | "completed"
  | "partial"
  | "cancelled"
  | "failed"
  | "superseded";

export type AnalysisArtifactStatus =
  | "candidate"
  | "committed"
  | "stale"
  | "invalidated"
  | "tombstoned";

export type AnalysisCompleteness =
  | "complete"
  | "partial"
  | "conflicted"
  | "insufficient"
  | "unavailable";

export type AnalysisVisibility = "user" | "governance" | "internal";
export type AnalysisDataClassification =
  | "public"
  | "workspace"
  | "confidential"
  | "restricted";

export type AnalysisArtifactLinkType =
  | "revision_of"
  | "derived_from"
  | "supports"
  | "contradicts"
  | "invalidates"
  | "produced_by";

export type AnalysisReceiptDecision =
  | "accepted"
  | "rejected"
  | "hold"
  | "no_go"
  | "rollback";

export type AnalysisManifestStatus =
  | "GO"
  | "HOLD"
  | "NO_GO"
  | "ROLLBACK"
  | "partial"
  | "cancelled";

export interface AnalysisBudgetContract {
  maxDurationMs: number;
  maxTokenCount: number;
  maxQueryCount: number;
  maxSearchCount: number;
  maxArtifactBytes: number;
}

export interface AnalysisGoalContract {
  version: "analysis-goal.v1";
  objective: string;
  decisionUse: string;
  workspaceId: string;
  datasourceIds: string[];
  allowedSourceKinds: string[];
  timeBoundary?: { from?: string; to?: string; timezone?: string };
  deliverables: string[];
  budget: AnalysisBudgetContract;
  riskLevel: "low" | "medium" | "high";
  stopConditions: string[];
}

export interface AnalysisTaskRevisionRecord {
  id: string;
  taskId: string;
  revision: number;
  status: "active" | "superseded" | "sealed";
  goalContract: AnalysisGoalContract;
  goalDigest: string;
  principalDigest: string;
  authPolicyVersion: string;
  createdByActorId: string;
  supersedesRevisionId?: string | null;
  createdAt: string;
}

export interface AnalysisAttemptRecord {
  id: string;
  taskId: string;
  revisionId: string;
  attempt: number;
  status: AnalysisAttemptStatus;
  authorityEpoch: number;
  idempotencyKey: string;
  failureReasonCode?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisEvent<TData = Record<string, unknown>> {
  protocol: typeof ANALYSIS_TASK_PROTOCOL_ID;
  version: typeof ANALYSIS_TASK_PROTOCOL_VERSION;
  id: string;
  taskId: string;
  revisionId?: string;
  attemptId?: string;
  sequence: number;
  idempotencyKey: string;
  type: string;
  visibility: AnalysisVisibility;
  at: string;
  data: TData;
}

export interface AnalysisArtifactMetadata {
  id: string;
  taskId: string;
  revisionId: string;
  attemptId?: string | null;
  artifactType: string;
  schemaVersion: string;
  status: AnalysisArtifactStatus;
  classification: AnalysisDataClassification;
  visibility: AnalysisVisibility;
  payloadDigest: string;
  payloadSizeBytes: number;
  completeness: AnalysisCompleteness;
  retentionExpiresAt?: string | null;
  payloadAvailable: boolean;
  staleAt?: string | null;
  invalidatedAt?: string | null;
  createdAt: string;
}

export interface AnalysisArtifactLink {
  id: string;
  taskId: string;
  sourceArtifactId: string;
  targetArtifactId: string;
  relationType: AnalysisArtifactLinkType;
  createdAt: string;
}

export interface AnalysisReceiptRecord {
  id: string;
  taskId: string;
  revisionId: string;
  attemptId?: string | null;
  artifactId?: string | null;
  receiptType: string;
  subjectType: string;
  subjectRef: string;
  subjectDigest: string;
  decision: AnalysisReceiptDecision;
  reasonCodes: string[];
  authorityEpoch: number;
  principalDigest: string;
  policyRefs: Record<string, string>;
  createdAt: string;
}

export interface AnalysisManifestRecord {
  id: string;
  taskId: string;
  revisionId: string;
  attemptId?: string | null;
  manifestType: string;
  schemaVersion: string;
  status: AnalysisManifestStatus;
  digest: string;
  artifactRefs: string[];
  receiptRefs: string[];
  limitations: string[];
  staleAt?: string | null;
  sealedAt: string;
  createdAt: string;
}

export interface AnalysisTaskRecord {
  id: string;
  workspaceId: string;
  createdByActorId: string;
  status: AnalysisTaskStatus;
  version: number;
  currentRevisionNumber: number;
  authorityEpoch: number;
  goalDigest: string;
  retentionExpiresAt?: string | null;
  terminalAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisTaskReadModel {
  task: AnalysisTaskRecord;
  currentRevision: AnalysisTaskRevisionRecord;
  attempts: AnalysisAttemptRecord[];
  events: AnalysisEvent[];
  artifacts: AnalysisArtifactMetadata[];
  receipts: AnalysisReceiptRecord[];
  manifests: AnalysisManifestRecord[];
}

export type AnalysisTaskCommandType =
  | "start"
  | "revise"
  | "decide"
  | "pause"
  | "resume"
  | "cancel";

export interface AnalysisTaskCommand<TPayload = Record<string, unknown>> {
  commandId: string;
  taskId: string;
  expectedTaskVersion: number;
  acceptedTaskVersion?: number;
  revisionId?: string;
  authorityEpoch: number;
  acceptedAuthorityEpoch?: number;
  type: AnalysisTaskCommandType;
  actorId: string;
  principalDigest: string;
  principalSnapshot?: {
    authenticationMethod: "dev_headers" | "oidc_bearer";
    trustLevel: "verified" | "development";
    requestedWorkspaceId?: string;
    roleSet: string[];
    authPolicyVersion: string;
  };
  at: string;
  payload: TPayload;
}

export interface AnalysisCommandAcceptance {
  commandId: string;
  taskId: string;
  accepted: boolean;
  reasonCode: string;
  taskVersion: number;
  authorityEpoch: number;
}
