import { Injectable } from "@nestjs/common";
import type {
  ClarificationDecisionEvidence,
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
  modelingRevision?: number;
  contextPackStatus?: "ready" | "degraded";
  semanticSpineVersion?: number;
  semanticLockStatus?: "locked" | "fallback" | "degraded";
  semanticInstructionSummary?: {
    modelBindingCount: number;
    relationshipBindingCount: number;
    metricBindingCount: number;
    calculatedFieldBindingCount: number;
  };
  contextPackDegradeReasons?: string[];
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
  modelingRevision?: number;
  semanticLockStatus?: "locked" | "fallback" | "degraded";
  contextPackStatus?: "ready" | "degraded";
  semanticInstructionSummary?: {
    modelBindingCount: number;
    relationshipBindingCount: number;
    metricBindingCount: number;
    calculatedFieldBindingCount: number;
  };
  semanticDegradeReason?: string;
}

interface EffectiveContextSummary {
  sourcePriority: "user_explicit_over_system";
  userEnvelope: {
    metricDefinitionProvided: boolean;
    timeRangeProvided: boolean;
    entityMappingCount: number;
    includeTableCount: number;
    excludeTableCount: number;
    businessConstraintCount: number;
  };
  retrievalContext?: {
    status?: "ready" | "degraded";
    selectedContextCount?: number;
  };
}

interface ContextConflictHint {
  hasConflict: boolean;
  preferredSource: "user_explicit";
  reasonCodes?: string[];
}

interface TraceContextEvidence {
  effectiveContextSummary?: EffectiveContextSummary;
  conflictHint?: ContextConflictHint;
}

interface SqlCoverageEvidenceSnapshot {
  gateStatus:
    | "passed"
    | "failed"
    | "skipped_no_evidence"
    | "skipped_metadata_intent"
    | "skipped_no_sql_objects";
  missingObjects: string[];
  triggerSource: "selected_context" | "semantic_context" | "explicit_pinning" | "none";
}

type ClarificationDecisionLayer = NonNullable<
  NonNullable<DeliveryContract["evidence"]>["clarificationDecision"]
>;

type DeliveryEvidenceWithContext = NonNullable<DeliveryContract["evidence"]> & {
  effectiveContextSummary?: EffectiveContextSummary;
  conflictHint?: ContextConflictHint;
  sqlCoverage?: SqlCoverageEvidenceSnapshot;
};

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
    const traceContextEvidence = this.readTraceContextEvidence(input.run);
    const clarificationDecision = this.readClarificationDecisionEvidence(input.run);
    const sqlCoverage = this.readSqlCoverageEvidence(input.run);
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
      ...(traceContextEvidence.conflictHint?.hasConflict
        ? ["context_conflict_detected"]
        : []),
      ...(sqlCoverage?.gateStatus === "failed" ? ["sql_coverage_gate_failed"] : []),
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

    const evidence: DeliveryEvidenceWithContext = {
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
      modelingRevision:
        semanticSnapshot.modelingRevision ?? finalSnapshot.modelingRevision,
      semanticSpineVersion:
        finalSnapshot.semanticSpineVersion ?? semanticSnapshot.semanticVersion,
      semanticLockStatus:
        finalSnapshot.semanticLockStatus ?? semanticSnapshot.semanticLockStatus,
      contextPackStatus:
        finalSnapshot.contextPackStatus ?? semanticSnapshot.contextPackStatus,
      semanticInstructionSummary:
        finalSnapshot.semanticInstructionSummary ??
        semanticSnapshot.semanticInstructionSummary,
      semanticDegradeReason:
        semanticSnapshot.semanticDegradeReason ??
        finalSnapshot.contextPackDegradeReasons?.at(0),
      skillContextSummary: fusedSnapshot.skillContextSummary,
      evidenceStale: evidenceStale || undefined,
      effectiveContextSummary: traceContextEvidence.effectiveContextSummary,
      conflictHint: traceContextEvidence.conflictHint,
      clarificationDecision,
      sqlCoverage
    };

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
    const degradeReasons = this.readStringArray(
      payload.degradeReasons ?? payload.degrade_reasons
    );
    const riskTags = this.readStringArray(payload.riskTags ?? payload.risk_tags);
    const selectedContextCountRaw =
      payload.selectedContextCount ?? payload.selected_context_count;
    const selectedContextCount =
      this.readNonNegativeInteger(selectedContextCountRaw);
    const contextPackRaw = this.readRecord(
      payload.contextPack ?? payload.context_pack
    );
    const contextPackStatusRaw = contextPackRaw
      ? this.readString(
          contextPackRaw.status ??
            contextPackRaw.contextPackStatus ??
            contextPackRaw.context_pack_status
        )
      : undefined;
    const contextPackStatus =
      contextPackStatusRaw === "degraded" ? "degraded" : contextPackStatusRaw === "ready" ? "ready" : undefined;
    const semanticSpineVersionRaw = contextPackRaw
      ? contextPackRaw.semanticVersion ?? contextPackRaw.semantic_version
      : undefined;
    const semanticSpineVersion = this.readPositiveInteger(semanticSpineVersionRaw);
    const semanticLockStatusRaw = contextPackRaw
      ? this.readString(
          contextPackRaw.semanticLockStatus ?? contextPackRaw.semantic_lock_status
        )
      : undefined;
    const semanticLockStatus =
      semanticLockStatusRaw === "locked" ||
      semanticLockStatusRaw === "fallback" ||
      semanticLockStatusRaw === "degraded"
        ? semanticLockStatusRaw
        : undefined;
    const modelingRevision = this.readPositiveInteger(
      contextPackRaw?.modelingRevision ??
        contextPackRaw?.modeling_revision ??
        contextPackRaw?.activeRevision ??
        contextPackRaw?.active_revision
    );
    const instructionSummaryRaw =
      this.readRecord(
        contextPackRaw?.instructionSummary ?? contextPackRaw?.instruction_summary
      );
    const semanticInstructionSummary = instructionSummaryRaw
      ? {
          modelBindingCount: this.readNonNegativeInt(
            instructionSummaryRaw.modelBindingCount ??
              instructionSummaryRaw.model_binding_count
          ),
          relationshipBindingCount: this.readNonNegativeInt(
            instructionSummaryRaw.relationshipBindingCount ??
              instructionSummaryRaw.relationship_binding_count
          ),
          metricBindingCount: this.readNonNegativeInt(
            instructionSummaryRaw.metricBindingCount ??
              instructionSummaryRaw.metric_binding_count
          ),
          calculatedFieldBindingCount: this.readNonNegativeInt(
            instructionSummaryRaw.calculatedFieldBindingCount ??
              instructionSummaryRaw.calculated_field_binding_count
          )
        }
      : undefined;
    const contextPackDegradeReasons = contextPackRaw
      ? this.readStringArray(
          contextPackRaw.degradeReasons ?? contextPackRaw.degrade_reasons
        )
      : [];

    return {
      status,
      degradeReasons,
      selectedContextCount,
      riskTags,
      modelingRevision,
      contextPackStatus,
      semanticSpineVersion,
      semanticLockStatus,
      semanticInstructionSummary,
      contextPackDegradeReasons
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
        const chunkId = this.readString(item.chunkId ?? item.chunk_id);
        if (!chunkId) {
          return undefined;
        }
        return {
          chunkId,
          sourceLane: this.readString(item.sourceLane ?? item.source_lane),
          domain: this.readString(item.domain)
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const skillContextSummary = this.readSkillContextSummary(
      payload.skillContext ?? payload.skill_context
    );

    return {
      status,
      candidates,
      skillContextSummary
    };
  }

  private readSemanticSnapshot(run: SqlRun): SemanticSnapshot {
    const traceWithCompat = run.trace as SqlRun["trace"] & {
      modeling_revision?: unknown;
    };
    const traceModelingRevision = this.readPositiveInteger(
      traceWithCompat.modelingRevision ?? traceWithCompat.modeling_revision
    );
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
      const semanticVersionCompatRaw =
        semanticVersionRaw ?? output.semantic_version;
      const semanticVersion = this.readPositiveInteger(semanticVersionCompatRaw);
      const lockStatus = this.readString(output.lockStatus ?? output.lock_status);
      const semanticLockStatus =
        lockStatus === "locked" || lockStatus === "fallback" || lockStatus === "degraded"
          ? lockStatus
          : undefined;
      const modelingRevision = this.readPositiveInteger(
        output.modelingRevision ??
          output.modeling_revision ??
          output.activeRevision ??
          output.active_revision
      );
      const contextPack = this.readRecord(output.contextPack ?? output.context_pack);
      const contextPackStatusRaw = this.readString(
        output.contextPackStatus ??
          output.context_pack_status ??
          contextPack?.status ??
          contextPack?.context_pack_status
      );
      const contextPackStatus =
        contextPackStatusRaw === "ready" || contextPackStatusRaw === "degraded"
          ? contextPackStatusRaw
          : undefined;
      const semanticInstructionSummary = this.readSemanticInstructionSummary(
        output.semanticBindingSummary ??
          output.semantic_binding_summary ??
          output.semanticInstructionSummary ??
          output.semantic_instruction_summary
      );
      const semanticDegradeReason = this.readString(output.degradeReason);
      const semanticDegradeReasonCompat =
        semanticDegradeReason ?? this.readString(output.degrade_reason);

      if (
        semanticVersion ||
        semanticLockStatus ||
        semanticDegradeReasonCompat ||
        modelingRevision !== undefined ||
        contextPackStatus ||
        semanticInstructionSummary
      ) {
        return {
          modelingRevision: traceModelingRevision ?? modelingRevision,
          semanticVersion,
          semanticLockStatus,
          contextPackStatus,
          semanticInstructionSummary,
          semanticDegradeReason: semanticDegradeReasonCompat
        };
      }
    }

    return { modelingRevision: traceModelingRevision };
  }

  private readTraceContextEvidence(run: SqlRun): TraceContextEvidence {
    const traceWithCompat = run.trace as SqlRun["trace"] & {
      effectiveContextSummary?: unknown;
      effective_context_summary?: unknown;
      conflictHint?: unknown;
      context_conflict_hint?: unknown;
    };

    return {
      effectiveContextSummary: this.readEffectiveContextSummary(
        traceWithCompat.effectiveContextSummary ??
          traceWithCompat.effective_context_summary
      ),
      conflictHint: this.readConflictHint(
        traceWithCompat.conflictHint ?? traceWithCompat.context_conflict_hint
      )
    };
  }

  private readClarificationDecisionEvidence(
    run: SqlRun
  ): ClarificationDecisionLayer | undefined {
    const traceWithCompat = run.trace as SqlRun["trace"] & {
      clarificationDecision?: unknown;
      clarification_decision?: unknown;
    };
    const traceDecision = this.readClarificationDecision(
      traceWithCompat.clarificationDecision ?? traceWithCompat.clarification_decision
    );
    if (traceDecision) {
      return traceDecision;
    }

    const stepDecision = this.readClarificationDecisionFromSteps(run.trace.steps);
    if (stepDecision) {
      return stepDecision;
    }

    return this.readClarificationDecision(run.clarification);
  }

  private readSqlCoverageEvidence(run: SqlRun): SqlCoverageEvidenceSnapshot | undefined {
    const steps = run.trace.steps ?? [];
    for (const step of [...steps].reverse()) {
      if (step.node !== "generate-sql") {
        continue;
      }
      const output = this.parseSummaryObject(step.outputSummary);
      if (!output) {
        continue;
      }
      const directCoverage = this.readSqlCoverageFromRecord(
        output.coverage ?? output.sqlCoverage ?? output.sql_coverage
      );
      if (directCoverage) {
        return directCoverage;
      }
      const errorCode = this.readString(output.errorCode ?? output.error_code);
      if (errorCode !== "LLM_SQL_EVIDENCE_COVERAGE_FAILED") {
        continue;
      }
      const errorDetails = this.readRecord(output.errorDetails ?? output.error_details);
      const detailsCoverage = this.readSqlCoverageFromRecord(
        errorDetails?.coverage ?? errorDetails?.sqlCoverage ?? errorDetails?.sql_coverage
      );
      if (detailsCoverage) {
        return detailsCoverage;
      }
    }
    return undefined;
  }

  private readSqlCoverageFromRecord(
    value: unknown
  ): SqlCoverageEvidenceSnapshot | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const gateStatusRaw = this.readString(value.gateStatus ?? value.gate_status);
    const gateStatus =
      gateStatusRaw === "passed" ||
      gateStatusRaw === "failed" ||
      gateStatusRaw === "skipped_no_evidence" ||
      gateStatusRaw === "skipped_metadata_intent" ||
      gateStatusRaw === "skipped_no_sql_objects"
        ? gateStatusRaw
        : undefined;
    const triggerSourceRaw = this.readString(
      value.triggerSource ?? value.trigger_source
    );
    const triggerSource =
      triggerSourceRaw === "selected_context" ||
      triggerSourceRaw === "semantic_context" ||
      triggerSourceRaw === "explicit_pinning" ||
      triggerSourceRaw === "none"
        ? triggerSourceRaw
        : undefined;
    if (!gateStatus || !triggerSource) {
      return undefined;
    }
    return {
      gateStatus,
      missingObjects: this.readStringArray(
        value.missingObjects ?? value.missing_objects
      ),
      triggerSource
    };
  }

  private readClarificationDecisionFromSteps(
    steps: SqlRun["trace"]["steps"] | undefined
  ): ClarificationDecisionLayer | undefined {
    if (!steps || steps.length === 0) {
      return undefined;
    }

    for (const step of [...steps].reverse()) {
      if (step.node !== "clarify") {
        continue;
      }
      const output = this.parseSummaryObject(step.outputSummary);
      if (!output) {
        continue;
      }
      const question = this.readString(
        output.clarificationQuestion ?? output.clarification_question
      );
      const stepDecision = this.readClarificationDecision(
        output.clarificationDecision ?? output.clarification_decision ?? output,
        {
          question,
          reason: this.readString(step.detail)
        }
      );
      if (stepDecision) {
        return stepDecision;
      }
    }

    return undefined;
  }

  private readClarificationDecision(
    value: unknown,
    fallback?: {
      question?: string;
      reason?: string;
    }
  ): ClarificationDecisionLayer | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }

    const decisionRaw = this.readString(value.decision)?.toLowerCase();
    const decision =
      decisionRaw === "continue" || decisionRaw === "clarify"
        ? (decisionRaw as ClarificationDecisionEvidence["decision"])
        : undefined;
    const triggerPathRaw = this.readString(
      value.triggerPath ??
        value.trigger_path ??
        value.triggerSource ??
        value.trigger_source
    )?.toLowerCase();
    const triggerPath =
      triggerPathRaw === "rule" ||
      triggerPathRaw === "semantic" ||
      triggerPathRaw === "hybrid"
        ? (triggerPathRaw as ClarificationDecisionEvidence["triggerPath"])
        : undefined;
    const decisionSource = this.readString(
      value.decisionSource ?? value.decision_source ?? value.source
    );
    const bypassed = this.readBoolean(value.bypassed ?? value.isBypassed ?? value.is_bypassed);
    const bypassReasonCode = this.readString(
      value.bypassReasonCode ?? value.bypass_reason_code
    );
    const confidenceLevelRaw = this.readString(
      value.confidenceLevel ?? value.confidence_level ?? value.confidence
    )?.toLowerCase();
    const confidenceLevel =
      confidenceLevelRaw === "high" ||
      confidenceLevelRaw === "medium" ||
      confidenceLevelRaw === "low"
        ? (confidenceLevelRaw as ClarificationDecisionEvidence["confidenceLevel"])
        : undefined;
    const missingCriticalSlots = this.readStringArray(
      value.missingCriticalSlots ??
        value.missing_critical_slots ??
        value.missingSlots ??
        value.missing_slots
    );
    const conflictDetected = this.readBoolean(
      value.conflictDetected ??
        value.conflict_detected ??
        value.hasConflict ??
        value.has_conflict
    );
    const reasonCodes = this.readStringArray(value.reasonCodes ?? value.reason_codes);
    const question = this.readString(
      value.question ??
        value.clarificationQuestion ??
        value.clarification_question ??
        fallback?.question
    );
    const reason = this.readString(value.reason ?? fallback?.reason);
    const hasStructuredPayload = Boolean(
      decision ||
        triggerPath ||
        decisionSource ||
        bypassed !== undefined ||
        bypassReasonCode ||
        confidenceLevel ||
        missingCriticalSlots.length > 0 ||
        conflictDetected !== undefined ||
        reasonCodes.length > 0
    );

    if (!hasStructuredPayload) {
      return undefined;
    }

    return {
      ...(decision ? { decision } : {}),
      ...(triggerPath ? { triggerPath } : {}),
      ...(decisionSource ? { decisionSource } : {}),
      ...(bypassed !== undefined ? { bypassed } : {}),
      ...(bypassReasonCode ? { bypassReasonCode } : {}),
      ...(confidenceLevel ? { confidenceLevel } : {}),
      ...(missingCriticalSlots.length > 0 ? { missingCriticalSlots } : {}),
      ...(conflictDetected !== undefined ? { conflictDetected } : {}),
      ...(reasonCodes.length > 0 ? { reasonCodes } : {}),
      ...(question ? { question } : {}),
      ...(reason ? { reason } : {})
    };
  }

  private readEffectiveContextSummary(value: unknown): EffectiveContextSummary | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const sourcePriority = this.readSourcePriority(value.sourcePriority);
    const userEnvelope = this.readEffectiveContextUserEnvelope(value.userEnvelope);
    if (!sourcePriority || !userEnvelope) {
      return undefined;
    }

    const retrievalContext = this.readEffectiveContextRetrieval(value.retrievalContext);

    return {
      sourcePriority,
      userEnvelope,
      ...(retrievalContext ? { retrievalContext } : {})
    };
  }

  private readConflictHint(value: unknown): ContextConflictHint | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const preferredSource = this.readPreferredSource(value.preferredSource);
    if (!preferredSource) {
      return undefined;
    }
    const hasConflict = Boolean(value.hasConflict);
    const reasonCodes = this.readStringArray(value.reasonCodes);
    return {
      hasConflict,
      preferredSource,
      ...(reasonCodes.length > 0 ? { reasonCodes } : {})
    };
  }

  private readEffectiveContextUserEnvelope(
    value: unknown
  ): EffectiveContextSummary["userEnvelope"] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }

    const entityMappingCount = this.readNonNegativeInteger(value.entityMappingCount);
    const includeTableCount = this.readNonNegativeInteger(value.includeTableCount);
    const excludeTableCount = this.readNonNegativeInteger(value.excludeTableCount);
    const businessConstraintCount = this.readNonNegativeInteger(
      value.businessConstraintCount
    );

    if (
      entityMappingCount === undefined ||
      includeTableCount === undefined ||
      excludeTableCount === undefined ||
      businessConstraintCount === undefined
    ) {
      return undefined;
    }

    return {
      metricDefinitionProvided: Boolean(value.metricDefinitionProvided),
      timeRangeProvided: Boolean(value.timeRangeProvided),
      entityMappingCount,
      includeTableCount,
      excludeTableCount,
      businessConstraintCount
    };
  }

  private readEffectiveContextRetrieval(
    value: unknown
  ): EffectiveContextSummary["retrievalContext"] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const statusRaw = value.status;
    const status = statusRaw === "ready" || statusRaw === "degraded" ? statusRaw : undefined;
    const selectedContextCount = this.readNonNegativeInteger(value.selectedContextCount);

    if (!status && selectedContextCount === undefined) {
      return undefined;
    }
    return {
      ...(status ? { status } : {}),
      ...(selectedContextCount !== undefined ? { selectedContextCount } : {})
    };
  }

  private readSourcePriority(
    value: unknown
  ): EffectiveContextSummary["sourcePriority"] | undefined {
    return value === "user_explicit_over_system" ? value : undefined;
  }

  private readPreferredSource(value: unknown): ContextConflictHint["preferredSource"] | undefined {
    return value === "user_explicit" ? value : undefined;
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
    const degradeReasonCompat =
      degradeReason ?? this.readString(value.degradeReason);
    if (skills.length === 0 && context.length === 0 && !degradeReasonCompat) {
      return undefined;
    }
    return {
      skillCount: skills.length,
      contextCount: context.length,
      degradeReason: degradeReasonCompat
    };
  }

  private readRecord(value: unknown): Record<string, unknown> | undefined {
    return this.isRecord(value) ? value : undefined;
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

  private readBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }
    return undefined;
  }

  private readNonNegativeInt(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
      }
    }
    return 0;
  }

  private readPositiveInteger(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    return undefined;
  }

  private readSemanticInstructionSummary(
    value: unknown
  ): SemanticSnapshot["semanticInstructionSummary"] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    return {
      modelBindingCount: this.readNonNegativeInt(value.modelBindingCount ?? value.model_binding_count),
      relationshipBindingCount: this.readNonNegativeInt(
        value.relationshipBindingCount ?? value.relationship_binding_count
      ),
      metricBindingCount: this.readNonNegativeInt(value.metricBindingCount ?? value.metric_binding_count),
      calculatedFieldBindingCount: this.readNonNegativeInt(
        value.calculatedFieldBindingCount ?? value.calculated_field_binding_count
      )
    };
  }

  private readNonNegativeInteger(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
      }
    }
    return undefined;
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
