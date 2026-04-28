import { Injectable } from "@nestjs/common";
import type { RagIndexBuildResult } from "../index/rag-index-builder.service";
import {
  BuildRagIndexJob,
  type BuildRagIndexJobInput
} from "../jobs/build-rag-index.job";
import { RagQualityService } from "../quality/rag-quality.service";
import { RagDatasourceQuotaPolicy } from "./rag-datasource-quota.policy";

export interface RagDatasourceOrchestratorInput extends Omit<BuildRagIndexJobInput, "queuedAt"> {
  workspaceId?: string;
  queuedAt?: string;
}

export interface RagDatasourceOrchestratorResult extends RagIndexBuildResult {
  queuedAt: string;
  startedAt: string;
  completedAt: string;
  queueWaitMs: number;
  isolationViolation: boolean;
}

interface RagDatasourceQueuedTask {
  input: RagDatasourceOrchestratorInput;
  queuedAt: string;
  workspaceId: string;
  resolve: (value: RagDatasourceOrchestratorResult) => void;
  reject: (reason?: unknown) => void;
}

@Injectable()
export class RagDatasourceOrchestratorService {
  private readonly queue: RagDatasourceQueuedTask[] = [];
  private readonly runningDatasourceIds = new Set<string>();
  private readonly runningByWorkspace = new Map<string, number>();
  private readonly circuitOpenUntilByDatasource = new Map<string, number>();
  private readonly consecutiveFailuresByDatasource = new Map<string, number>();
  private runningGlobal = 0;

  constructor(
    private readonly buildJob: BuildRagIndexJob,
    private readonly ragQualityService: RagQualityService,
    private readonly quotaPolicy: RagDatasourceQuotaPolicy
  ) {}

  async enqueueBuild(
    input: RagDatasourceOrchestratorInput
  ): Promise<RagDatasourceOrchestratorResult> {
    const normalizedInput = this.normalizeInput(input);
    return new Promise<RagDatasourceOrchestratorResult>((resolve, reject) => {
      this.queue.push({
        input: normalizedInput,
        queuedAt: normalizedInput.queuedAt ?? new Date().toISOString(),
        workspaceId: normalizedInput.workspaceId ?? "default_workspace",
        resolve,
        reject
      });
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    let dispatched = true;
    while (dispatched) {
      dispatched = false;
      const taskIndex = this.findDispatchableTaskIndex();
      if (taskIndex < 0) {
        return;
      }
      const task = this.queue.splice(taskIndex, 1)[0];
      if (!task) {
        return;
      }
      dispatched = true;
      void this.startTask(task);
    }
  }

  private async startTask(task: RagDatasourceQueuedTask): Promise<void> {
    const datasourceId = task.input.datasourceId;
    const workspaceId = task.workspaceId;
    this.runningDatasourceIds.add(datasourceId);
    this.runningGlobal += 1;
    this.runningByWorkspace.set(
      workspaceId,
      (this.runningByWorkspace.get(workspaceId) ?? 0) + 1
    );

    const startedAt = new Date().toISOString();
    const queuedAtMs = Date.parse(task.queuedAt);
    const startedAtMs = Date.parse(startedAt);
    const queueWaitMs =
      Number.isNaN(queuedAtMs) || Number.isNaN(startedAtMs)
        ? 0
        : Math.max(0, startedAtMs - queuedAtMs);

    try {
      const buildResult = await this.buildJob.run({
        ...task.input,
        queuedAt: task.queuedAt
      });
      this.consecutiveFailuresByDatasource.delete(datasourceId);
      this.circuitOpenUntilByDatasource.delete(datasourceId);

      const isolationViolation = buildResult.datasourceId !== datasourceId;
      this.ragQualityService.recordDatasourceOrchestration({
        datasourceId,
        workspaceId,
        queueWaitMs,
        isolationViolation,
        recordedAt: new Date().toISOString()
      });

      task.resolve({
        ...buildResult,
        queuedAt: task.queuedAt,
        startedAt,
        completedAt: new Date().toISOString(),
        queueWaitMs,
        isolationViolation
      });
    } catch (error) {
      const failureCount = (this.consecutiveFailuresByDatasource.get(datasourceId) ?? 0) + 1;
      this.consecutiveFailuresByDatasource.set(datasourceId, failureCount);

      const config = this.quotaPolicy.resolveConfig();
      if (failureCount >= config.circuitBreakerFailures) {
        const cooldownUntil = Date.now() + config.circuitBreakerCooldownMs;
        this.circuitOpenUntilByDatasource.set(datasourceId, cooldownUntil);
        setTimeout(() => this.drainQueue(), config.circuitBreakerCooldownMs);
      }

      this.ragQualityService.recordDatasourceOrchestration({
        datasourceId,
        workspaceId,
        queueWaitMs,
        isolationViolation: false,
        recordedAt: new Date().toISOString()
      });

      task.reject(error);
    } finally {
      this.runningDatasourceIds.delete(datasourceId);
      this.runningGlobal = Math.max(0, this.runningGlobal - 1);
      const workspaceRunning = (this.runningByWorkspace.get(workspaceId) ?? 1) - 1;
      if (workspaceRunning <= 0) {
        this.runningByWorkspace.delete(workspaceId);
      } else {
        this.runningByWorkspace.set(workspaceId, workspaceRunning);
      }
      this.drainQueue();
    }
  }

  private findDispatchableTaskIndex(): number {
    for (let index = 0; index < this.queue.length; index += 1) {
      const task = this.queue[index];
      if (!task) {
        continue;
      }
      if (this.runningDatasourceIds.has(task.input.datasourceId)) {
        continue;
      }
      const isCircuitOpen = this.isDatasourceCircuitOpen(task.input.datasourceId);
      const runningInWorkspace = this.runningByWorkspace.get(task.workspaceId) ?? 0;
      const decision = this.quotaPolicy.canDispatch({
        runningGlobal: this.runningGlobal,
        runningInWorkspace,
        workspaceId: task.workspaceId,
        datasourceCircuitOpen: isCircuitOpen
      });
      if (decision.allowed) {
        return index;
      }
    }
    return -1;
  }

  private isDatasourceCircuitOpen(datasourceId: string): boolean {
    const openUntil = this.circuitOpenUntilByDatasource.get(datasourceId);
    if (!openUntil) {
      return false;
    }
    if (openUntil <= Date.now()) {
      this.circuitOpenUntilByDatasource.delete(datasourceId);
      return false;
    }
    return true;
  }

  private normalizeInput(input: RagDatasourceOrchestratorInput): RagDatasourceOrchestratorInput {
    const datasourceId = input.datasourceId.trim();
    if (!datasourceId) {
      throw new Error("rag datasource orchestrator datasourceId 不能为空");
    }
    const sourceVersion = input.sourceVersion.trim();
    if (!sourceVersion) {
      throw new Error("rag datasource orchestrator sourceVersion 不能为空");
    }
    return {
      ...input,
      datasourceId,
      sourceVersion,
      workspaceId: input.workspaceId?.trim() || "default_workspace",
      queuedAt: input.queuedAt
    };
  }
}

