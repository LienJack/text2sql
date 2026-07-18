import { Injectable } from "@nestjs/common";
import type { AnalysisTaskCommand } from "@text2sql/analysis-task-protocol";
import {
  DurableWorkflowPort,
  type DurableWorkflowDescriptor,
  type DurableWorkflowHealth,
  type DurableWorkflowState
} from "./contracts/durable-workflow.port";

@Injectable()
export class InMemoryDurableWorkflowAdapter extends DurableWorkflowPort {
  private readonly workflows = new Map<string, DurableWorkflowState>();

  async startWorkflow(descriptor: DurableWorkflowDescriptor): Promise<void> {
    if (this.workflows.has(descriptor.taskId)) {
      return;
    }
    this.workflows.set(descriptor.taskId, {
      ...descriptor,
      workflowVersion: "generic-analysis-workflow.v1-test",
      status: "queued",
      processedCommandIds: []
    });
  }

  async deliverCommand(command: AnalysisTaskCommand): Promise<void> {
    const current = this.workflows.get(command.taskId);
    if (!current) {
      throw new Error(`workflow not found: ${command.taskId}`);
    }
    if (current.processedCommandIds.includes(command.commandId)) {
      return;
    }
    const status = this.resolveStatus(current.status, command.type);
    this.workflows.set(command.taskId, {
      ...current,
      revisionId: command.revisionId ?? current.revisionId,
      authorityEpoch: command.acceptedAuthorityEpoch ?? command.authorityEpoch,
      taskVersion: command.acceptedTaskVersion ?? command.expectedTaskVersion,
      status,
      processedCommandIds: [...current.processedCommandIds, command.commandId],
      lastCommandId: command.commandId
    });
  }

  async describeWorkflow(taskId: string): Promise<DurableWorkflowState | null> {
    const state = this.workflows.get(taskId);
    return state ? { ...state, processedCommandIds: [...state.processedCommandIds] } : null;
  }

  async health(): Promise<DurableWorkflowHealth> {
    return {
      provider: "in_memory",
      configured: true,
      clientReady: true,
      workerPollerReady: true,
      reasonCode: "test_only_non_durable_adapter"
    };
  }

  async close(): Promise<void> {
    this.workflows.clear();
  }

  private resolveStatus(
    current: DurableWorkflowState["status"],
    command: AnalysisTaskCommand["type"]
  ): DurableWorkflowState["status"] {
    if (command === "start" || command === "resume" || command === "decide") {
      return "running";
    }
    if (command === "pause") {
      return "paused";
    }
    if (command === "cancel") {
      return "cancelled";
    }
    if (command === "revise") {
      return current === "paused" ? "paused" : "queued";
    }
    return current;
  }
}
