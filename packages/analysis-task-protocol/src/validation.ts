import { ANALYSIS_TASK_TERMINAL_STATUSES } from "./types";
import type { AnalysisEvent, AnalysisTaskStatus } from "./types";

const terminalStatuses = new Set<string>(ANALYSIS_TASK_TERMINAL_STATUSES);

export const isAnalysisTaskTerminalStatus = (
  status: AnalysisTaskStatus
): boolean => terminalStatuses.has(status);

export const assertAnalysisEvent = (value: unknown): AnalysisEvent => {
  if (!value || typeof value !== "object") {
    throw new Error("analysis event must be an object");
  }
  const event = value as Partial<AnalysisEvent>;
  if (
    event.protocol !== "analysis-task-protocol" ||
    event.version !== "1.0.0" ||
    typeof event.id !== "string" ||
    typeof event.taskId !== "string" ||
    !Number.isSafeInteger(event.sequence) ||
    Number(event.sequence) < 1 ||
    typeof event.idempotencyKey !== "string" ||
    typeof event.type !== "string" ||
    typeof event.at !== "string" ||
    !event.data ||
    typeof event.data !== "object"
  ) {
    throw new Error("invalid analysis event envelope");
  }
  return event as AnalysisEvent;
};
