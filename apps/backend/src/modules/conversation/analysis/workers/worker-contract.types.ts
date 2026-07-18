import type { AnalysisCompleteness } from "@text2sql/analysis-task-protocol";
import type { AnalysisWorkKind } from "../orchestration/work-graph.types";

export type AnalysisCapability =
  | "datasource.read"
  | "artifact.read"
  | "artifact.propose"
  | "web.search"
  | "web.fetch"
  | "calculation.execute"
  | "claim.challenge";

export interface AnalysisBudgetReservation {
  maxDurationMs: number;
  maxTokenCount: number;
  maxQueryCount: number;
  maxSearchCount: number;
  maxArtifactBytes: number;
}

export interface AnalysisWorkerInvocation {
  invocationId: string;
  taskId: string;
  revisionId: string;
  attemptId: string;
  workItemId: string;
  workKind: AnalysisWorkKind;
  authorityEpoch: number;
  actor: Express.RequestActor;
  datasourceId?: string;
  instruction: string;
  capabilityGrant: AnalysisCapability[];
  capabilityGrantDigest: string;
  budgetReservation: AnalysisBudgetReservation;
  inputArtifactRefs: Array<{ id: string; digest: string }>;
  inputDigest: string;
  expectedOutputSchema: string;
  allowedOutputSchemas?: string[];
}

export interface AnalysisWorkerCandidate {
  candidateId: string;
  artifactType: string;
  schemaVersion: string;
  completeness: AnalysisCompleteness;
  payload: Record<string, unknown>;
  receiptStatus: "passed" | "failed" | "unavailable";
  receiptRefs: string[];
  reasonCodes: string[];
  derivedFromCandidateIds?: string[];
}

export interface AnalysisWorkerProposal {
  proposalId: string;
  invocationId: string;
  workerId: string;
  workerVersion: string;
  taskId: string;
  revisionId: string;
  attemptId: string;
  authorityEpoch: number;
  inputDigest: string;
  requestedCapabilities: AnalysisCapability[];
  candidates: AnalysisWorkerCandidate[];
  cost: {
    durationMs: number;
    tokenCount: number;
    queryCount: number;
    searchCount: number;
    artifactBytes: number;
  };
  unresolvedGaps: string[];
}

export interface AnalysisWorker {
  readonly workerId: string;
  readonly workerVersion: string;
  readonly workKinds: AnalysisWorkKind[];
  readonly capabilities: AnalysisCapability[];
  execute(invocation: AnalysisWorkerInvocation): Promise<AnalysisWorkerProposal>;
}
