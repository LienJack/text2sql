import { Inject, Injectable, Optional } from "@nestjs/common";
import type { DeliveryArtifactLayer } from "@text2sql/shared-types";
import {
  DEFAULT_DELIVERY_SANDBOX_POLICY,
  type DeliverySandboxPolicy,
  isSandboxFilesystemWriteAllowed,
  isSandboxNetworkAllowed,
  isSandboxProcessSpawnAllowed
} from "./sandbox-policy";

export const DELIVERY_SANDBOX_REPLAY_KEY = "delivery:sandbox_postprocess";
export const DELIVERY_SANDBOX_POLICY_TOKEN = "DELIVERY_SANDBOX_POLICY_TOKEN";

export type SandboxPostProcessOperation =
  | {
      type: "rows_preview_limit";
      maxRows: number;
    }
  | {
      type: "network_request";
      host: string;
      protocol?: string;
      port?: number;
    }
  | {
      type: "file_write";
      path: string;
    }
  | {
      type: "process_spawn";
      command: string;
    }
  | {
      type: "unknown";
      rawType?: string;
    };

export interface SandboxPostProcessRequest {
  policyVersion?: string;
  operations: SandboxPostProcessOperation[];
}

export type SandboxExecutionResult =
  | {
      ok: true;
      artifact: DeliveryArtifactLayer;
      policyVersion: string;
    }
  | {
      ok: false;
      policyVersion: string;
      riskTags: string[];
      reason: string;
    };

@Injectable()
export class SandboxRuntimeService {
  private readonly policy: DeliverySandboxPolicy;

  constructor(
    @Optional()
    @Inject(DELIVERY_SANDBOX_POLICY_TOKEN)
    policy?: DeliverySandboxPolicy
  ) {
    this.policy = policy ?? DEFAULT_DELIVERY_SANDBOX_POLICY;
  }

  executeArtifactPostProcess(input: {
    artifact: DeliveryArtifactLayer;
    request: SandboxPostProcessRequest;
  }): SandboxExecutionResult {
    if (
      input.request.policyVersion &&
      input.request.policyVersion !== this.policy.version
    ) {
      return this.fail("sandbox_policy_version_mismatch", "Sandbox policy version mismatch.");
    }

    const cloned = this.cloneArtifact(input.artifact);
    for (const operation of input.request.operations) {
      if (operation.type === "rows_preview_limit") {
        if (!Number.isFinite(operation.maxRows) || operation.maxRows < 0) {
          return this.fail(
            "sandbox_invalid_operation",
            "rows_preview_limit maxRows must be a non-negative number."
          );
        }
        cloned.rowsPreview = cloned.rowsPreview?.slice(0, Math.floor(operation.maxRows));
        continue;
      }

      if (operation.type === "network_request") {
        const allowed = isSandboxNetworkAllowed(this.policy, {
          host: operation.host,
          protocol: operation.protocol,
          port: operation.port
        });
        if (!allowed) {
          return this.fail("sandbox_network_denied", "Outbound network access blocked by policy.");
        }
        continue;
      }

      if (operation.type === "file_write") {
        const allowed = isSandboxFilesystemWriteAllowed(this.policy, operation.path);
        if (!allowed) {
          return this.fail("sandbox_filesystem_denied", "Filesystem write blocked by policy.");
        }
        continue;
      }

      if (operation.type === "process_spawn") {
        const allowed = isSandboxProcessSpawnAllowed(this.policy, operation.command);
        if (!allowed) {
          return this.fail("sandbox_process_denied", "Process spawn blocked by policy.");
        }
        continue;
      }

      return this.fail(
        "sandbox_unknown_operation",
        `Sandbox operation "${operation.rawType ?? "unknown"}" is not supported.`
      );
    }

    return {
      ok: true,
      artifact: cloned,
      policyVersion: this.policy.version
    };
  }

  private fail(tag: string, reason: string): SandboxExecutionResult {
    return {
      ok: false,
      policyVersion: this.policy.version,
      riskTags: [tag],
      reason
    };
  }

  private cloneArtifact(artifact: DeliveryArtifactLayer): DeliveryArtifactLayer {
    return {
      ...artifact,
      columns: artifact.columns ? [...artifact.columns] : undefined,
      rowsPreview: artifact.rowsPreview
        ? artifact.rowsPreview.map((row) => ({ ...row }))
        : undefined
    };
  }
}
