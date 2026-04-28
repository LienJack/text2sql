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
        const maxRows = Math.floor(operation.maxRows);
        cloned.rowsPreview = cloned.rowsPreview?.slice(0, maxRows);
        const tableWithCompat = cloned.table as
          | (NonNullable<DeliveryArtifactLayer["table"]> & {
              truncated?: boolean;
            })
          | undefined;
        if (tableWithCompat) {
          const tableRowsPreview = tableWithCompat.rowsPreview?.slice(0, maxRows);
          tableWithCompat.rowsPreview = tableRowsPreview;
          tableWithCompat.previewRowCount = tableRowsPreview?.length ?? 0;
          const tableRowCount =
            typeof tableWithCompat.rowCount === "number"
              ? tableWithCompat.rowCount
              : cloned.rowCount;
          tableWithCompat.truncated = tableRowCount > tableWithCompat.previewRowCount;
        }
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
      summary: artifact.summary
        ? {
            ...artifact.summary,
            metrics: artifact.summary.metrics?.map((item) => ({ ...item })),
            dimensions: artifact.summary.dimensions
              ? [...artifact.summary.dimensions]
              : undefined
          }
        : undefined,
      table: artifact.table
        ? {
            ...artifact.table,
            columns: artifact.table.columns ? [...artifact.table.columns] : undefined,
            rowsPreview: artifact.table.rowsPreview
              ? artifact.table.rowsPreview.map((row) => ({ ...row }))
              : undefined
          }
        : undefined,
      chart: artifact.chart
        ? {
            ...artifact.chart,
            mappings: artifact.chart.mappings ? { ...artifact.chart.mappings } : undefined,
            series: artifact.chart.series
              ? artifact.chart.series.map((series) => ({ ...series }))
              : undefined,
            meta: artifact.chart.meta ? { ...artifact.chart.meta } : undefined
          }
        : undefined,
      validation: artifact.validation
        ? {
            ...artifact.validation,
            reasonCodes: artifact.validation.reasonCodes
              ? [...artifact.validation.reasonCodes]
              : undefined
          }
        : undefined,
      fallback: artifact.fallback ? { ...artifact.fallback } : undefined,
      visualIntent: artifact.visualIntent
        ? {
            ...artifact.visualIntent,
            mappings: artifact.visualIntent.mappings
              ? { ...artifact.visualIntent.mappings }
              : undefined,
            normalizedIntent: this.cloneRecord(artifact.visualIntent.normalizedIntent)
          }
        : undefined,
      columns: artifact.columns ? [...artifact.columns] : undefined,
      rowsPreview: artifact.rowsPreview
        ? artifact.rowsPreview.map((row) => ({ ...row }))
        : undefined
    };
  }

  private cloneRecord(
    value: Record<string, unknown> | undefined
  ): Record<string, unknown> | undefined {
    return value ? { ...value } : undefined;
  }
}
