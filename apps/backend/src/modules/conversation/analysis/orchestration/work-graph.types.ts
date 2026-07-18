import type { AnalysisBudgetContract } from "@text2sql/analysis-task-protocol";

export type AnalysisWorkKind =
  | "text2sql"
  | "research"
  | "evidence_alignment"
  | "calculation"
  | "critique"
  | "report";

export type AnalysisProofObligationKind =
  | "metric_definition"
  | "internal_data_evidence"
  | "segment_explanation"
  | "external_context"
  | "source_alignment"
  | "deterministic_calculation"
  | "counter_evidence"
  | "supported_report";

export interface AnalysisProofObligation {
  id: string;
  kind: AnalysisProofObligationKind;
  description: string;
  mandatory: boolean;
  status: "open" | "satisfied" | "blocked" | "deferred";
  evidenceRefs: string[];
  reasonCodes: string[];
}

export interface AnalysisWorkItem {
  id: string;
  kind: AnalysisWorkKind;
  workerId: string;
  description: string;
  obligationIds: string[];
  dependencies: string[];
  datasourceId?: string;
  mandatory: boolean;
  supported: boolean;
  status: "pending" | "running" | "completed" | "failed" | "deferred";
  reasonCodes: string[];
}

export interface AnalysisWorkGraph {
  version: "analysis-work-graph.v1";
  taskId: string;
  revisionId: string;
  goalDigest: string;
  graphDigest: string;
  budget: AnalysisBudgetContract;
  stopConditions: string[];
  obligations: AnalysisProofObligation[];
  workItems: AnalysisWorkItem[];
  supportedKinds: AnalysisWorkKind[];
  deferredKinds: AnalysisWorkKind[];
  multiWorkerMode: "off" | "shadow";
  compiledAt: string;
}
