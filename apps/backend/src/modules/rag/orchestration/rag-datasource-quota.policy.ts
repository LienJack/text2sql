import { Injectable } from "@nestjs/common";

export interface RagDatasourceQuotaPolicyConfig {
  globalConcurrency: number;
  workspaceConcurrency: number;
  circuitBreakerFailures: number;
  circuitBreakerCooldownMs: number;
}

export interface RagDatasourceDispatchContext {
  runningGlobal: number;
  runningInWorkspace: number;
  workspaceId: string;
  datasourceCircuitOpen: boolean;
}

export interface RagDatasourceDispatchDecision {
  allowed: boolean;
  reason?:
    | "global_concurrency_exceeded"
    | "workspace_concurrency_exceeded"
    | "datasource_circuit_open";
}

const DEFAULT_CONFIG: RagDatasourceQuotaPolicyConfig = {
  globalConcurrency: 2,
  workspaceConcurrency: 2,
  circuitBreakerFailures: 3,
  circuitBreakerCooldownMs: 60_000
};

@Injectable()
export class RagDatasourceQuotaPolicy {
  private readonly config: RagDatasourceQuotaPolicyConfig = {
    ...DEFAULT_CONFIG
  };

  resolveConfig(): RagDatasourceQuotaPolicyConfig {
    return { ...this.config };
  }

  canDispatch(input: RagDatasourceDispatchContext): RagDatasourceDispatchDecision {
    if (input.datasourceCircuitOpen) {
      return {
        allowed: false,
        reason: "datasource_circuit_open"
      };
    }
    if (input.runningGlobal >= this.config.globalConcurrency) {
      return {
        allowed: false,
        reason: "global_concurrency_exceeded"
      };
    }
    if (input.runningInWorkspace >= this.config.workspaceConcurrency) {
      return {
        allowed: false,
        reason: "workspace_concurrency_exceeded"
      };
    }
    return { allowed: true };
  }
}
