import type { MemoryPromotionService } from "../memory/memory-promotion.service";
import type { SavedPriorSqlService } from "../memory/saved-prior-sql.service";

export const KNOWLEDGE_MEMORY_CONTRACT = Symbol("KNOWLEDGE_MEMORY_CONTRACT");

export type SavedPriorSqlCaptureOutcome =
  | "captured"
  | "duplicate"
  | "skipped_ineligible"
  | "capture_failed";

export interface SavedPriorSqlCaptureInput {
  workspaceId: string;
  datasourceId: string;
  sourceRunId: string;
  sourceRunStatus: string;
  sourceRunCreatedAt?: string;
  question?: string;
  sql: string;
  viewId: string;
  viewName: string;
  viewSql: string;
  tableNames?: string[];
  columnNames?: string[];
  replayed: boolean;
  savedAt?: string;
}

export interface SavedPriorSqlRecord {
  priorId: string;
  workspaceId: string;
  datasourceId: string;
  sourceRunId: string;
  sourceRunStatus: string;
  sourceRunCreatedAt?: string;
  viewId: string;
  viewName: string;
  question: string;
  sql: string;
  tableNames: string[];
  columnNames: string[];
  savedAt: string;
  metadata: {
    trusted: true;
    verified: true;
    priorSql: true;
  };
}

export interface SavedPriorSqlCaptureResult {
  outcome: SavedPriorSqlCaptureOutcome;
  priorId: string;
  replayKey: string;
  reason?: string;
  record?: SavedPriorSqlRecord;
}

export interface KnowledgeMemoryContract {
  promotion: Pick<
    MemoryPromotionService,
    | "promoteFromRun"
    | "getRecord"
    | "listCompensations"
    | "buildCandidateIdForRun"
    | "applyFeedback"
  >;
  savedPriorSql: Pick<
    SavedPriorSqlService,
    "captureFromSavedView" | "getRecord" | "listRecords" | "buildPriorId"
  >;
}
