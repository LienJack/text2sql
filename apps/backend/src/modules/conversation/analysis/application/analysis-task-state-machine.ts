import type {
  AnalysisTaskCommandType,
  AnalysisTaskStatus
} from "@text2sql/analysis-task-protocol";
import { DomainError } from "../../../../common/domain-error";

export type AnalysisTaskTransition = {
  nextStatus: AnalysisTaskStatus;
  incrementAuthorityEpoch: boolean;
  terminal: boolean;
};

const transitions: Partial<
  Record<
    AnalysisTaskStatus,
    Partial<Record<AnalysisTaskCommandType, AnalysisTaskTransition>>
  >
> = {
  draft: {
    start: transition("queued"),
    revise: transition("draft"),
    cancel: transition("cancelled", true, true)
  },
  queued: {
    pause: transition("paused", true),
    revise: transition("draft"),
    cancel: transition("cancelled", true, true)
  },
  running: {
    pause: transition("paused", true),
    cancel: transition("cancelled", true, true)
  },
  waiting_for_human: {
    decide: transition("queued"),
    pause: transition("paused", true),
    revise: transition("draft"),
    cancel: transition("cancelled", true, true)
  },
  pausing: {
    cancel: transition("cancelled", true, true)
  },
  paused: {
    resume: transition("queued"),
    revise: transition("draft"),
    cancel: transition("cancelled", true, true)
  },
  cancelling: {},
  completed: { revise: transition("draft") },
  partial: { revise: transition("draft") },
  failed: { revise: transition("draft") },
  cancelled: { revise: transition("draft") }
};

export const resolveAnalysisTaskTransition = (
  status: AnalysisTaskStatus,
  command: AnalysisTaskCommandType
): AnalysisTaskTransition => {
  const resolved = transitions[status]?.[command];
  if (!resolved) {
    throw new DomainError(
      "ANALYSIS_COMMAND_NOT_ALLOWED",
      `Task 状态 ${status} 不允许执行 ${command}。`,
      409,
      { status, command }
    );
  }
  return resolved;
};

function transition(
  nextStatus: AnalysisTaskStatus,
  incrementAuthorityEpoch = false,
  terminal = false
): AnalysisTaskTransition {
  return { nextStatus, incrementAuthorityEpoch, terminal };
}
