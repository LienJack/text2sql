import type { AnalysisTaskCommand } from "@text2sql/analysis-task-protocol";
import {
  condition,
  defineQuery,
  defineSignal,
  patched,
  setHandler
} from "@temporalio/workflow";
import type {
  DurableWorkflowDescriptor,
  DurableWorkflowState
} from "../contracts/durable-workflow.port";
import {
  ANALYSIS_COMMAND_SIGNAL,
  ANALYSIS_STATE_QUERY
} from "./analysis-workflow.contract";

export const analysisCommandSignal =
  defineSignal<[AnalysisTaskCommand]>(ANALYSIS_COMMAND_SIGNAL);
export const analysisStateQuery =
  defineQuery<DurableWorkflowState>(ANALYSIS_STATE_QUERY);

const terminal = new Set(["completed", "partial", "cancelled", "failed"]);

export async function genericAnalysisWorkflow(
  descriptor: DurableWorkflowDescriptor
): Promise<DurableWorkflowState> {
  const workflowVersion = patched("generic-analysis-workflow-v1")
    ? "generic-analysis-workflow.v1"
    : "generic-analysis-workflow.legacy";
  const queue: AnalysisTaskCommand[] = [];
  let state: DurableWorkflowState = {
    ...descriptor,
    workflowVersion,
    status: "queued",
    processedCommandIds: []
  };

  setHandler(analysisCommandSignal, (command) => {
    if (!state.processedCommandIds.includes(command.commandId)) {
      queue.push(command);
    }
  });
  setHandler(analysisStateQuery, () => state);

  while (!terminal.has(state.status)) {
    await condition(() => queue.length > 0 || terminal.has(state.status));
    while (queue.length > 0) {
      const command = queue.shift()!;
      if (state.processedCommandIds.includes(command.commandId)) {
        continue;
      }
      state = applyCommand(state, command);
    }
  }
  return state;
}

const applyCommand = (
  state: DurableWorkflowState,
  command: AnalysisTaskCommand
): DurableWorkflowState => {
  let status = state.status;
  if (command.type === "start" || command.type === "resume" || command.type === "decide") {
    status = "running";
  } else if (command.type === "pause") {
    status = "paused";
  } else if (command.type === "cancel") {
    status = "cancelled";
  } else if (command.type === "revise") {
    status = state.status === "paused" ? "paused" : "queued";
  }
  return {
    ...state,
    revisionId: command.revisionId ?? state.revisionId,
    authorityEpoch: command.acceptedAuthorityEpoch ?? command.authorityEpoch,
    taskVersion: command.acceptedTaskVersion ?? command.expectedTaskVersion,
    status,
    processedCommandIds: [...state.processedCommandIds, command.commandId],
    lastCommandId: command.commandId
  };
};
