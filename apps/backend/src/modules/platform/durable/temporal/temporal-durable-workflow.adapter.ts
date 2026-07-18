import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type { AnalysisTaskCommand } from "@text2sql/analysis-task-protocol";
import { Client, Connection } from "@temporalio/client";
import { DomainError } from "../../../../common/domain-error";
import { AppConfigService } from "../../../config/app-config.service";
import {
  DurableWorkflowPort,
  type DurableWorkflowDescriptor,
  type DurableWorkflowHealth,
  type DurableWorkflowState
} from "../contracts/durable-workflow.port";
import {
  ANALYSIS_COMMAND_SIGNAL,
  ANALYSIS_STATE_QUERY,
  GENERIC_ANALYSIS_WORKFLOW_NAME
} from "./analysis-workflow.contract";

@Injectable()
export class TemporalDurableWorkflowAdapter
  extends DurableWorkflowPort
  implements OnModuleDestroy
{
  private connection?: Connection;
  private client?: Client;

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async startWorkflow(descriptor: DurableWorkflowDescriptor): Promise<void> {
    const client = await this.getClient();
    try {
      await client.workflow.start(GENERIC_ANALYSIS_WORKFLOW_NAME, {
        workflowId: this.workflowId(descriptor.taskId),
        taskQueue: this.config.temporalTaskQueue,
        args: [descriptor]
      });
    } catch (error) {
      if (this.errorName(error) === "WorkflowExecutionAlreadyStartedError") {
        return;
      }
      throw this.providerError("TEMPORAL_WORKFLOW_START_FAILED", error);
    }
  }

  async deliverCommand(command: AnalysisTaskCommand): Promise<void> {
    try {
      const client = await this.getClient();
      await client.workflow
        .getHandle(this.workflowId(command.taskId))
        .signal(ANALYSIS_COMMAND_SIGNAL, command);
    } catch (error) {
      throw this.providerError("TEMPORAL_SIGNAL_FAILED", error);
    }
  }

  async describeWorkflow(taskId: string): Promise<DurableWorkflowState | null> {
    try {
      const client = await this.getClient();
      return await client.workflow
        .getHandle(this.workflowId(taskId))
        .query<DurableWorkflowState>(ANALYSIS_STATE_QUERY);
    } catch (error) {
      if (this.errorName(error) === "WorkflowNotFoundError") {
        return null;
      }
      throw this.providerError("TEMPORAL_QUERY_FAILED", error);
    }
  }

  async health(): Promise<DurableWorkflowHealth> {
    try {
      const connection = await this.getConnection();
      await connection.workflowService.getSystemInfo({});
      const taskQueue = await connection.workflowService.describeTaskQueue({
        namespace: this.config.temporalNamespace,
        taskQueue: { name: this.config.temporalTaskQueue },
        taskQueueType: 1
      });
      return {
        provider: "temporal",
        configured: Boolean(this.config.temporalAddress),
        clientReady: true,
        workerPollerReady: (taskQueue.pollers?.length ?? 0) > 0,
        ...((taskQueue.pollers?.length ?? 0) > 0
          ? {}
          : { reasonCode: "analysis_worker_poller_missing" })
      };
    } catch {
      return {
        provider: "temporal",
        configured: Boolean(this.config.temporalAddress),
        clientReady: false,
        workerPollerReady: false,
        reasonCode: "temporal_unavailable"
      };
    }
  }

  async close(): Promise<void> {
    this.client = undefined;
    await this.connection?.close();
    this.connection = undefined;
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  private async getClient(): Promise<Client> {
    if (!this.client) {
      this.client = new Client({
        connection: await this.getConnection(),
        namespace: this.config.temporalNamespace
      });
    }
    return this.client;
  }

  private async getConnection(): Promise<Connection> {
    if (!this.connection) {
      this.connection = await Connection.connect({
        address: this.config.temporalAddress,
        connectTimeout: this.config.temporalConnectionTimeoutMs
      });
    }
    return this.connection;
  }

  private workflowId(taskId: string): string {
    return `analysis-task:${taskId}`;
  }

  private providerError(code: string, error: unknown): DomainError {
    return new DomainError(code, "Temporal durable workflow 暂不可用。", 503, {
      reasonCode: this.errorName(error)
    });
  }

  private errorName(error: unknown): string {
    return error instanceof Error ? error.name : "unknown";
  }
}
