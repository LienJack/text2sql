import type {
  AnalysisTaskCommand,
  AnalysisTaskStatus
} from "@text2sql/analysis-task-protocol";

export type DurableWorkflowDescriptor = {
  taskId: string;
  revisionId: string;
  authorityEpoch: number;
  taskVersion: number;
};

export type DurableWorkflowState = DurableWorkflowDescriptor & {
  workflowVersion: string;
  status: AnalysisTaskStatus;
  processedCommandIds: string[];
  lastCommandId?: string;
};

export type DurableWorkflowHealth = {
  provider: "temporal" | "in_memory";
  configured: boolean;
  clientReady: boolean;
  workerPollerReady: boolean | "unknown";
  reasonCode?: string;
};

export abstract class DurableWorkflowPort {
  abstract startWorkflow(descriptor: DurableWorkflowDescriptor): Promise<void>;

  abstract deliverCommand(command: AnalysisTaskCommand): Promise<void>;

  abstract describeWorkflow(taskId: string): Promise<DurableWorkflowState | null>;

  abstract health(): Promise<DurableWorkflowHealth>;

  abstract close(): Promise<void>;
}
