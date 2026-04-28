import { Injectable } from "@nestjs/common";
import type {
  DeliveryContract,
  DeliveryEvidenceReplayLog,
  SqlRun
} from "@text2sql/shared-types";
import {
  DELIVERY_SANDBOX_REPLAY_KEY,
  SandboxRuntimeService,
  type SandboxPostProcessOperation,
  type SandboxPostProcessRequest
} from "./sandbox/sandbox-runtime.service";

export interface DeliveryReplayRecordInput {
  replayKey: string;
  stage: string;
  indexVersionId?: string;
  payload?: string;
  createdAt: string;
}

export interface DeliveryContractMapperInput {
  run: SqlRun;
  replayRecords?: DeliveryReplayRecordInput[];
}

interface RerankFinalSnapshot {
  status: "ready" | "degraded";
  degradeReasons: string[];
  selectedContextCount?: number;
  riskTags: string[];
}

interface RetrievalFusedSnapshot {
  status: "ready" | "degraded";
  candidates: Array<{
    chunkId: string;
    sourceLane?: string;
    domain?: string;
  }>;
  skillContextSummary?: {
    skillCount: number;
    contextCount: number;
    degradeReason?: string;
  };
}

interface SemanticSnapshot {
  semanticVersion?: number;
  semanticLockStatus?: "locked" | "fallback" | "degraded";
  semanticDegradeReason?: string;
}

interface SandboxPostProcessOutcome {
  artifact?: DeliveryContract["artifact"];
  riskTags: string[];
}

@Injectable()
export class DeliveryContractMapper {
  constructor(private readonly sandboxRuntime: SandboxRuntimeService) {}

  map(input: DeliveryContractMapperInput): DeliveryContract {
    const answer = this.buildAnswer(input.run);
    const replayLogs = this.toReplayLogs(input.replayRecords);
    const replayIndex = this.indexReplayRecords(input.replayRecords);

    const finalSnapshot = this.readRerankFinalSnapshot(replayIndex.rerankFinal);
    const fusedSnapshot = this.readRetrievalFusedSnapshot(replayIndex.retrievalFused);
    const semanticSnapshot = this.readSemanticSnapshot(input.run);
    const invalidInput = replayIndex.invalidPayload;
    const artifact = this.buildArtifact(input.run);
    const sandboxOutcome = this.applySandboxPostProcess({
      artifact,
      sandboxPayload: replayIndex.sandboxPostprocess,
      sandboxPayloadInvalid: replayIndex.sandboxPayloadInvalid
    });

    const evidenceRiskTags = this.unique([
      ...finalSnapshot.riskTags,
      ...(invalidInput ? ["delivery_input_invalid"] : []),
      ...sandboxOutcome.riskTags
    ]);

    const selectedContextCount =
      finalSnapshot.selectedContextCount ??
      (fusedSnapshot.candidates.length > 0
        ? Math.min(3, fusedSnapshot.candidates.length)
        : undefined);

    const snippets = fusedSnapshot.candidates
      .slice(0, 3)
      .map((candidate) => this.formatSnippet(candidate))
      .filter((item): item is string => Boolean(item));

    const hasIndexSnapshot = replayLogs.some((item) => Boolean(item.indexVersionId));
    const evidenceStale = Boolean(
      selectedContextCount && selectedContextCount > 0 && !hasIndexSnapshot
    );

    const hasReplayData = Boolean(replayIndex.rerankFinal || replayIndex.retrievalFused);
    const derivedRetrievalStatus = hasReplayData
      ? (finalSnapshot.status ?? fusedSnapshot.status)
      : (input.run.error ? "degraded" : undefined);

    const evidence = {
      runId: input.run.runId,
      retrievalStatus: derivedRetrievalStatus,
      degradeReasons: finalSnapshot.degradeReasons,
      selectedContext:
        selectedContextCount !== undefined
          ? {
              count: selectedContextCount,
              snippets: snippets.length > 0 ? snippets : undefined
            }
          : undefined,
      retrievalLogs: replayLogs.length > 0 ? replayLogs : undefined,
      riskTags: evidenceRiskTags.length > 0 ? evidenceRiskTags : undefined,
      semanticVersion: semanticSnapshot.semanticVersion,
      semanticLockStatus: semanticSnapshot.semanticLockStatus,
      semanticDegradeReason: semanticSnapshot.semanticDegradeReason,
      skillContextSummary: fusedSnapshot.skillContextSummary,
      evidenceStale: evidenceStale || undefined
    } satisfies DeliveryContract["evidence"];

    return {
      answer,
      evidence,
      artifact: sandboxOutcome.artifact ?? artifact
    };
  }

  buildFallback(run: SqlRun, riskTag: string): DeliveryContract {
    const artifact = this.buildArtifact(run);
    return {
      answer: this.buildAnswer(run),
      evidence: {
        runId: run.runId,
        riskTags: this.unique([riskTag])
      },
      artifact
    };
  }

  private buildAnswer(run: SqlRun): DeliveryContract["answer"] {
    return {
      text: run.answer ?? run.error ?? "系统未返回结果。",
      status: run.status,
      provider: run.provider,
      model: run.model
    };
  }

  private buildArtifact(run: SqlRun): DeliveryContract["artifact"] | undefined {
    const hasArtifact = Boolean(
      run.sql || (run.columns?.length ?? 0) > 0 || (run.rows?.length ?? 0) > 0 || run.error
    );
    if (!hasArtifact) {
      return undefined;
    }
    return {
      sql: run.sql,
      columns: run.columns,
      rowCount: run.rows?.length ?? 0,
      rowsPreview: run.rows?.slice(0, 3),
      hasError: Boolean(run.error)
    };
  }

  private toReplayLogs(records: DeliveryReplayRecordInput[] | undefined): DeliveryEvidenceReplayLog[] {
    if (!records || records.length === 0) {
      return [];
    }
    return records
      .map((item) => ({
        replayKey: item.replayKey,
        stage: item.stage,
        indexVersionId: item.indexVersionId,
        createdAt: item.createdAt
      }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private indexReplayRecords(records: DeliveryReplayRecordInput[] | undefined): {
    rerankFinal?: Record<string, unknown>;
    retrievalFused?: Record<string, unknown>;
    sandboxPostprocess?: Record<string, unknown>;
    invalidPayload: boolean;
    sandboxPayloadInvalid: boolean;
  } {
    if (!records || records.length === 0) {
      return {
        invalidPayload: false,
        sandboxPayloadInvalid: false
      };
    }

    let invalidPayload = false;
    let sandboxPayloadInvalid = false;
    let rerankFinal: Record<string, unknown> | undefined;
    let retrievalFused: Record<string, unknown> | undefined;
    let sandboxPostprocess: Record<string, unknown> | undefined;

    for (const item of records) {
      if (!item.payload) {
        continue;
      }
      const parsed = this.parsePayload(item.payload);
      if (!parsed) {
        invalidPayload = true;
        if (item.replayKey === DELIVERY_SANDBOX_REPLAY_KEY) {
          sandboxPayloadInvalid = true;
        }
        continue;
      }
      if (item.replayKey === "rerank:final") {
        rerankFinal = parsed;
      }
      if (item.replayKey === "retrieval:fused") {
        retrievalFused = parsed;
      }
      if (item.replayKey === DELIVERY_SANDBOX_REPLAY_KEY) {
        sandboxPostprocess = parsed;
      }
    }

    return {
      rerankFinal,
      retrievalFused,
      sandboxPostprocess,
      invalidPayload,
      sandboxPayloadInvalid
    };
  }

  private applySandboxPostProcess(input: {
    artifact: DeliveryContract["artifact"];
    sandboxPayload: Record<string, unknown> | undefined;
    sandboxPayloadInvalid: boolean;
  }): SandboxPostProcessOutcome {
    if (!input.artifact) {
      return {
        artifact: undefined,
        riskTags: input.sandboxPayloadInvalid ? ["sandbox_failed", "sandbox_payload_invalid"] : []
      };
    }

    if (input.sandboxPayloadInvalid) {
      return {
        artifact: input.artifact,
        riskTags: ["sandbox_failed", "sandbox_payload_invalid"]
      };
    }

    if (!input.sandboxPayload) {
      return {
        artifact: input.artifact,
        riskTags: []
      };
    }

    const request = this.readSandboxRequest(input.sandboxPayload);
    if (!request) {
      return {
        artifact: input.artifact,
        riskTags: ["sandbox_failed", "sandbox_payload_invalid"]
      };
    }

    try {
      const result = this.sandboxRuntime.executeArtifactPostProcess({
        artifact: input.artifact,
        request
      });
      if (!result.ok) {
        return {
          artifact: input.artifact,
          riskTags: this.unique(["sandbox_failed", ...result.riskTags])
        };
      }
      return {
        artifact: result.artifact,
        riskTags: []
      };
    } catch {
      return {
        artifact: input.artifact,
        riskTags: ["sandbox_failed", "sandbox_runtime_failed"]
      };
    }
  }

  private readRerankFinalSnapshot(
    payload: Record<string, unknown> | undefined
  ): RerankFinalSnapshot {
    if (!payload) {
      return {
        status: "ready",
        degradeReasons: [],
        riskTags: []
      };
    }

    const statusRaw = payload.status;
    const status = statusRaw === "degraded" ? "degraded" : "ready";
    const degradeReasons = this.readStringArray(payload.degradeReasons);
    const riskTags = this.readStringArray(payload.riskTags);
    const selectedContextCountRaw = payload.selectedContextCount;
    const selectedContextCount =
      typeof selectedContextCountRaw === "number" &&
      Number.isFinite(selectedContextCountRaw) &&
      selectedContextCountRaw >= 0
        ? Math.floor(selectedContextCountRaw)
        : undefined;

    return {
      status,
      degradeReasons,
      selectedContextCount,
      riskTags
    };
  }

  private readRetrievalFusedSnapshot(
    payload: Record<string, unknown> | undefined
  ): RetrievalFusedSnapshot {
    if (!payload) {
      return {
        status: "ready",
        candidates: []
      };
    }

    const statusRaw = payload.status;
    const status = statusRaw === "degraded" ? "degraded" : "ready";
    const candidatesRaw = Array.isArray(payload.candidates) ? payload.candidates : [];
    const candidates = candidatesRaw
      .map((item) => {
        if (!this.isRecord(item)) {
          return undefined;
        }
        const chunkId = this.readString(item.chunkId);
        if (!chunkId) {
          return undefined;
        }
        return {
          chunkId,
          sourceLane: this.readString(item.sourceLane),
          domain: this.readString(item.domain)
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const skillContextSummary = this.readSkillContextSummary(payload.skillContext);

    return {
      status,
      candidates,
      skillContextSummary
    };
  }

  private readSemanticSnapshot(run: SqlRun): SemanticSnapshot {
    const semanticSteps = [...(run.trace.steps ?? [])]
      .reverse()
      .filter(
        (step) =>
          step.node === "build-semantic-query" || step.node === "build-physical-plan"
      );

    for (const step of semanticSteps) {
      const output = this.parseSummaryObject(step.outputSummary);
      if (!output) {
        continue;
      }
      const semanticVersionRaw = output.semanticVersion;
      const semanticVersion =
        typeof semanticVersionRaw === "number" &&
        Number.isFinite(semanticVersionRaw) &&
        semanticVersionRaw > 0
          ? Math.floor(semanticVersionRaw)
          : undefined;
      const lockStatus = this.readString(output.lockStatus);
      const semanticLockStatus =
        lockStatus === "locked" || lockStatus === "fallback" || lockStatus === "degraded"
          ? lockStatus
          : undefined;
      const semanticDegradeReason = this.readString(output.degradeReason);

      if (semanticVersion || semanticLockStatus || semanticDegradeReason) {
        return {
          semanticVersion,
          semanticLockStatus,
          semanticDegradeReason
        };
      }
    }

    return {};
  }

  private readSkillContextSummary(
    value: unknown
  ): RetrievalFusedSnapshot["skillContextSummary"] {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const skills = Array.isArray(value.skills) ? value.skills : [];
    const context = Array.isArray(value.context) ? value.context : [];
    const degradeReason = this.readString(value.degrade_reason);
    if (skills.length === 0 && context.length === 0 && !degradeReason) {
      return undefined;
    }
    return {
      skillCount: skills.length,
      contextCount: context.length,
      degradeReason
    };
  }

  private formatSnippet(candidate: {
    chunkId: string;
    sourceLane?: string;
    domain?: string;
  }): string | undefined {
    const parts = [
      `chunk:${candidate.chunkId}`,
      candidate.sourceLane ? `lane:${candidate.sourceLane}` : undefined,
      candidate.domain ? `domain:${candidate.domain}` : undefined
    ].filter((item): item is string => Boolean(item));
    if (parts.length === 0) {
      return undefined;
    }
    return parts.join(" ");
  }

  private parsePayload(payload: string): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(payload);
      if (!this.isRecord(parsed)) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private parseSummaryObject(summary: string | undefined): Record<string, unknown> | undefined {
    if (!summary) {
      return undefined;
    }
    const trimmed = summary.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return undefined;
    }
    return this.parsePayload(trimmed);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return this.unique(
      value
        .map((item) => this.readString(item))
        .filter((item): item is string => Boolean(item))
    );
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
  }

  private readSandboxRequest(payload: Record<string, unknown>): SandboxPostProcessRequest | undefined {
    const operationsRaw = Array.isArray(payload.operations) ? payload.operations : undefined;
    if (!operationsRaw) {
      return undefined;
    }

    const operations: SandboxPostProcessOperation[] = [];
    for (const item of operationsRaw) {
      const parsed = this.parseSandboxOperation(item);
      if (!parsed) {
        return undefined;
      }
      operations.push(parsed);
    }

    return {
      policyVersion: this.readString(payload.policyVersion),
      operations
    };
  }

  private parseSandboxOperation(value: unknown): SandboxPostProcessOperation | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const type = this.readString(value.type);
    if (!type) {
      return undefined;
    }

    if (type === "rows_preview_limit") {
      const maxRowsRaw = value.maxRows;
      if (typeof maxRowsRaw !== "number" || !Number.isFinite(maxRowsRaw)) {
        return undefined;
      }
      return {
        type,
        maxRows: maxRowsRaw
      };
    }

    if (type === "network_request") {
      const host = this.readString(value.host);
      if (!host) {
        return undefined;
      }
      const portRaw = value.port;
      const port =
        typeof portRaw === "number" && Number.isFinite(portRaw) ? Math.floor(portRaw) : undefined;
      return {
        type,
        host,
        protocol: this.readString(value.protocol),
        port
      };
    }

    if (type === "file_write") {
      const path = this.readString(value.path);
      if (!path) {
        return undefined;
      }
      return {
        type,
        path
      };
    }

    if (type === "process_spawn") {
      const command = this.readString(value.command);
      if (!command) {
        return undefined;
      }
      return {
        type,
        command
      };
    }

    return {
      type: "unknown",
      rawType: type
    };
  }
}
