import { Injectable } from "@nestjs/common";
import type {
  ClarificationDecisionEvidence,
  DeliveryContract,
  DeliveryContextPackSummaryV1,
  DeliveryMetadataAnswerSummaryV1,
  DeliveryEvidenceReplayLog,
  SqlCorrectionGroundingV1,
  SqlRun,
  Text2SqlV2ArtifactRefV1,
  Text2SqlV2RunArtifact,
  Text2SqlV2RuntimePlanV1,
  Text2SqlV2SmartDefaultsEvidenceV1,
  Text2SqlV2StageName
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
  artifactOverride?: DeliveryContract["artifact"];
  additionalRiskTags?: string[];
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
    assetFamily?: string;
    manifestFingerprint?: string;
    lifecycleState?: string;
  }>;
  preparationPlane?: {
    manifestFingerprints: string[];
    assetFamilyCounts: Record<string, number>;
    permissionFilteredAssetCount: number;
    twoPassSchemaRecallApplied: boolean;
  };
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

interface SavedPriorSqlEvidenceSnapshot {
  status: "hit" | "miss" | "filtered" | "stale" | "ambiguous";
  shortcutUsed: boolean;
  reasonCodes?: string[];
  selectedChunkId?: string;
  selectedViewId?: string;
  selectedViewName?: string;
  selectedSourceRunId?: string;
  safetyResult?: "passed" | "rejected" | "fallback_generated";
}

type ClarificationDecisionLayer = NonNullable<
  NonNullable<DeliveryContract["evidence"]>["clarificationDecision"]
>;

type DeliveryEvidenceWithContext = NonNullable<DeliveryContract["evidence"]> & {
  effectiveContextSummary?: EffectiveContextSummary;
  conflictHint?: ContextConflictHint;
  sqlCoverage?: SqlCoverageEvidenceSnapshot;
  savedPriorSql?: SavedPriorSqlEvidenceSnapshot;
  preparationPlane?: RetrievalFusedSnapshot["preparationPlane"];
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
    const savedPriorSql = this.readSavedPriorSqlEvidence(input.run);
    const traceV2Artifact = this.readTraceV2Artifact(input.run);
    const contextPackSummary = this.readContextPackSummary(
      traceV2Artifact?.contextPack
    );
    const metadataAnswer = this.readMetadataAnswerSummary({
      run: input.run,
      traceV2: traceV2Artifact,
      contextPackSummary
    });
    const correctionGrounding = this.readCorrectionGrounding(traceV2Artifact);
    const invalidInput = replayIndex.invalidPayload;
    const artifact = input.artifactOverride ?? this.buildArtifact(input.run);
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
      ...(savedPriorSql?.safetyResult === "rejected"
        ? ["saved_prior_sql_safety_rejected"]
        : []),
      ...(input.additionalRiskTags ?? []),
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
      semanticVersion:
        semanticSnapshot.semanticVersion ?? finalSnapshot.semanticSpineVersion,
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
      preparationPlane: fusedSnapshot.preparationPlane,
      evidenceStale: evidenceStale || undefined,
      effectiveContextSummary: traceContextEvidence.effectiveContextSummary,
      conflictHint: traceContextEvidence.conflictHint,
      clarificationDecision,
      sqlCoverage,
      savedPriorSql,
      contextPackSummary,
      metadataAnswer,
      correctionGrounding,
      ...(traceV2Artifact
        ? {
            v2: {
              version: traceV2Artifact.version,
              stageOrder: traceV2Artifact.stageOrder,
              stageArtifacts: traceV2Artifact.stages,
              contextPack: traceV2Artifact.contextPack,
              semanticPlan: this.toSafeSemanticPlan(traceV2Artifact.semanticPlan),
              sqlGeneration: traceV2Artifact.sqlGeneration,
              sqlValidation: traceV2Artifact.sqlValidation,
              planLedger:
                traceV2Artifact.planLedger ??
                traceV2Artifact.sqlValidation?.ledgerFulfillment ??
                traceV2Artifact.semanticPlan?.planLedger?.summary,
              runtimePlan: this.readRuntimePlan(traceV2Artifact.runtimePlan),
              artifactRefs: this.readArtifactRefs(traceV2Artifact.artifactRefs),
              smartDefaults: this.readSmartDefaults(traceV2Artifact.smartDefaults),
              loopEvidence: traceV2Artifact.loopEvidence,
              terminationReason: traceV2Artifact.terminationReason,
              failure: this.resolveTraceV2Failure(traceV2Artifact)
            }
          }
        : {})
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

  private toSafeSemanticPlan<T extends { planLedger?: unknown } | undefined>(
    semanticPlan: T
  ): T {
    if (!semanticPlan) {
      return semanticPlan;
    }
    const { planLedger: _planLedger, ...safePlan } = semanticPlan;
    return safePlan as T;
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
          domain: this.readString(item.domain),
          assetFamily: this.readString(item.assetFamily ?? item.asset_family),
          manifestFingerprint: this.readString(
            item.manifestFingerprint ?? item.manifest_fingerprint
          ),
          lifecycleState: this.readString(item.lifecycleState ?? item.lifecycle_state)
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const skillContextSummary = this.readSkillContextSummary(
      payload.skillContext ?? payload.skill_context
    );
    const permissionFiltering = this.readRecord(
      payload.permissionFiltering ?? payload.permission_filtering
    );
    const twoPassSchemaRecall = this.readRecord(
      payload.twoPassSchemaRecall ?? payload.two_pass_schema_recall
    );
    const assetFamilyCounts = candidates.reduce<Record<string, number>>(
      (accumulator, candidate) => {
        if (candidate.assetFamily) {
          accumulator[candidate.assetFamily] =
            (accumulator[candidate.assetFamily] ?? 0) + 1;
        }
        return accumulator;
      },
      {}
    );
    const manifestFingerprints = this.unique(
      candidates
        .map((candidate) => candidate.manifestFingerprint)
        .filter((item): item is string => Boolean(item))
    );
    const preparationPlane =
      manifestFingerprints.length > 0 || Object.keys(assetFamilyCounts).length > 0
        ? {
            manifestFingerprints,
            assetFamilyCounts,
            permissionFilteredAssetCount: this.readNonNegativeInt(
              permissionFiltering?.filteredCount ?? permissionFiltering?.filtered_count
            ),
            twoPassSchemaRecallApplied:
              this.readString(twoPassSchemaRecall?.status) === "applied"
          }
        : undefined;

    return {
      status,
      candidates,
      preparationPlane,
      skillContextSummary
    };
  }

  private readSemanticSnapshot(run: SqlRun): SemanticSnapshot {
    const traceModelingRevision = this.readPositiveInteger(run.trace.modelingRevision);
    const traceV2 = this.readTraceV2Artifact(run);
    const contextPackStatus =
      traceV2?.contextPack?.status === "ready" || traceV2?.contextPack?.status === "degraded"
        ? traceV2.contextPack.status
        : undefined;
    const semanticDegradeReason = traceV2?.contextPack?.warnings?.find(
      (item) => typeof item === "string" && item.trim().length > 0
    );

    return {
      modelingRevision: traceModelingRevision,
      contextPackStatus,
      semanticDegradeReason
    };
  }

  private readTraceContextEvidence(run: SqlRun): TraceContextEvidence {
    return {
      effectiveContextSummary: this.readEffectiveContextSummary(
        run.trace.effectiveContextSummary
      ),
      conflictHint: this.readConflictHint(run.trace.conflictHint)
    };
  }

  private readClarificationDecisionEvidence(
    run: SqlRun
  ): ClarificationDecisionLayer | undefined {
    const traceDecision = this.readClarificationDecision(run.trace.clarificationDecision);
    if (traceDecision) {
      return traceDecision;
    }
    return this.readClarificationDecision(run.clarification);
  }

  private readSqlCoverageEvidence(run: SqlRun): SqlCoverageEvidenceSnapshot | undefined {
    const checks = run.trace.v2?.sqlValidation?.checks;
    if (!Array.isArray(checks)) {
      return undefined;
    }
    const coverageCheck = checks.find((item) => item.check === "plan-coverage");
    if (!coverageCheck) {
      return undefined;
    }
    const gateStatus =
      coverageCheck.status === "passed"
        ? "passed"
        : coverageCheck.status === "failed"
          ? "failed"
          : "skipped_no_evidence";
    return {
      gateStatus,
      missingObjects: [],
      triggerSource: "semantic_context"
    };
  }

  private readSavedPriorSqlEvidence(
    run: SqlRun
  ): SavedPriorSqlEvidenceSnapshot | undefined {
    const stages = run.trace.v2?.stages;
    if (!Array.isArray(stages) || stages.length === 0) {
      return undefined;
    }
    const generateStage = stages.find((stage) => stage.stage === "generate-sql");
    if (!generateStage || generateStage.status !== "skipped") {
      return undefined;
    }
    const validateStage = stages.find((stage) => stage.stage === "validate");
    const safetyResult: SavedPriorSqlEvidenceSnapshot["safetyResult"] | undefined =
      validateStage?.status === "success"
        ? "passed"
        : validateStage?.status === "failed"
          ? "rejected"
          : undefined;
    const shortcutUsed = safetyResult === "passed";

    return {
      status: "hit",
      shortcutUsed,
      reasonCodes: ["saved_prior_sql_shortcut"],
      ...(safetyResult ? { safetyResult } : {})
    };
  }

  private readContextPackSummary(
    contextPack: Text2SqlV2RunArtifact["contextPack"] | undefined
  ): DeliveryContextPackSummaryV1 | undefined {
    if (!contextPack) {
      return undefined;
    }

    const selectedEvidenceCount =
      contextPack.selectedContextSummary?.count ??
      contextPack.selectedEvidenceIds.length;
    const selectedTableCount = contextPack.selectedTables.length;
    const selectedColumnCount = contextPack.selectedColumns.length;
    const pruningApplied = Boolean(contextPack.pruning?.applied);
    const prunedEvidenceCount = (contextPack.pruning?.decisions ?? []).reduce(
      (total, decision) =>
        total +
        (this.readNonNegativeInteger(decision.removedCount) ??
          decision.removedEvidenceIds?.length ??
          0),
      0
    );
    const degradedLaneCount = (contextPack.laneStates ?? []).filter(
      (lane) => lane.state === "degraded" || lane.state === "unavailable"
    ).length;
    const permissionFilteringApplied =
      contextPack.permissionFiltering?.status === "applied";
    const permissionDeniedEvidenceCount =
      contextPack.permissionFiltering?.deniedEvidenceCount ??
      contextPack.permissionFiltering?.deniedEvidenceIds?.length ??
      0;
    const degradationReasons = this.unique([
      ...(contextPack.degradation?.reasons ?? []),
      ...(contextPack.warnings ?? [])
    ]);

    return {
      status: contextPack.status,
      selectedEvidenceCount,
      selectedTableCount,
      selectedColumnCount,
      pruningApplied,
      ...(pruningApplied ? { prunedEvidenceCount } : {}),
      ...(degradedLaneCount > 0 ? { degradedLaneCount } : {}),
      permissionFilteringApplied,
      ...(permissionFilteringApplied
        ? {
            permissionDeniedEvidenceCount
          }
        : {}),
      ...(degradationReasons.length > 0 ? { degradationReasons } : {})
    };
  }

  private readMetadataAnswerSummary(input: {
    run: SqlRun;
    traceV2: Text2SqlV2RunArtifact | undefined;
    contextPackSummary: DeliveryContextPackSummaryV1 | undefined;
  }): DeliveryMetadataAnswerSummaryV1 | undefined {
    const routeKind =
      this.readSemanticPlanRouteKind(input.traceV2?.semanticPlan) ??
      this.readRouteKindFromIntakeStage(input.traceV2?.stages);
    if (routeKind !== "metadata" && routeKind !== "general") {
      return undefined;
    }

    const selectedEvidenceCount = input.contextPackSummary?.selectedEvidenceCount ?? 0;
    const degradationReasons = input.contextPackSummary?.degradationReasons ?? [];
    const evidenceQuality =
      input.contextPackSummary?.status === "ready" ? "ready" : "degraded";
    const groundedByContextPack = Boolean(
      input.traceV2?.contextPack && selectedEvidenceCount > 0
    );

    return {
      groundedByContextPack,
      routeKind,
      evidenceQuality,
      selectedEvidenceCount,
      permissionFilteringApplied:
        input.contextPackSummary?.permissionFilteringApplied ?? false,
      pruningApplied: input.contextPackSummary?.pruningApplied ?? false,
      ...(degradationReasons.length > 0 ? { degradationReasons } : {})
    };
  }

  private readCorrectionGrounding(
    traceV2: Text2SqlV2RunArtifact | undefined
  ): SqlCorrectionGroundingV1 | undefined {
    if (!traceV2) {
      return undefined;
    }

    const direct = this.normalizeCorrectionGrounding(
      traceV2.sqlGeneration?.correctionGrounding
    );
    if (direct) {
      return direct;
    }

    const generateStage = traceV2.stages.find((stage) => stage.stage === "generate-sql");
    if (!generateStage?.metadata || !this.isRecord(generateStage.metadata)) {
      return undefined;
    }
    return this.normalizeCorrectionGrounding(
      (generateStage.metadata as { correctionGrounding?: unknown }).correctionGrounding
    );
  }

  private readRuntimePlan(value: unknown): Text2SqlV2RuntimePlanV1 | undefined {
    if (!this.isRecord(value) || value.version !== "runtime-plan.v1") {
      return undefined;
    }
    const items = Array.isArray(value.items)
      ? value.items
          .map((item) => this.readRuntimePlanItem(item))
          .filter((item): item is Text2SqlV2RuntimePlanV1["items"][number] =>
            Boolean(item)
          )
      : [];
    if (items.length === 0) {
      return undefined;
    }
    return {
      version: "runtime-plan.v1",
      items,
      ...(this.readString(value.currentItemId)
        ? { currentItemId: this.readString(value.currentItemId) }
        : {}),
      ...(this.readString(value.summary)
        ? { summary: this.readString(value.summary) }
        : {})
    };
  }

  private readRuntimePlanItem(
    value: unknown
  ): Text2SqlV2RuntimePlanV1["items"][number] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const id = this.readString(value.id);
    const stage = this.readStageName(value.stage);
    const goal = this.readString(value.goal);
    const status = this.readRuntimePlanStatus(value.status);
    if (!id || !stage || !goal || !status) {
      return undefined;
    }
    const correctionIntent = this.readRuntimePlanCorrectionIntent(
      value.correctionIntent
    );
    return {
      id,
      stage,
      goal,
      status,
      ...(this.readStringArray(value.reasonCodes).length > 0
        ? { reasonCodes: this.readStringArray(value.reasonCodes) }
        : {}),
      ...(this.readStringArray(value.evidenceRefs).length > 0
        ? { evidenceRefs: this.readStringArray(value.evidenceRefs) }
        : {}),
      ...(correctionIntent ? { correctionIntent } : {}),
      ...(this.readString(value.startedAt)
        ? { startedAt: this.readString(value.startedAt) }
        : {}),
      ...(this.readString(value.endedAt)
        ? { endedAt: this.readString(value.endedAt) }
        : {}),
      ...(this.readString(value.summary)
        ? { summary: this.readString(value.summary) }
        : {})
    };
  }

  private readRuntimePlanCorrectionIntent(
    value: unknown
  ): Text2SqlV2RuntimePlanV1["items"][number]["correctionIntent"] | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const retryReason = this.readString(value.retryReason);
    if (!retryReason) {
      return undefined;
    }
    return {
      ...(this.readStageName(value.failedStage)
        ? { failedStage: this.readStageName(value.failedStage) }
        : {}),
      ...(this.readString(value.failureCode)
        ? { failureCode: this.readString(value.failureCode) }
        : {}),
      retryReason,
      ...(this.readStageName(value.targetStage)
        ? { targetStage: this.readStageName(value.targetStage) }
        : {})
    };
  }

  private readArtifactRefs(value: unknown): Text2SqlV2ArtifactRefV1[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const refs = value
      .map((item) => this.readArtifactRef(item))
      .filter((item): item is Text2SqlV2ArtifactRefV1 => Boolean(item));
    return refs.length > 0 ? refs : undefined;
  }

  private readArtifactRef(value: unknown): Text2SqlV2ArtifactRefV1 | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const id = this.readString(value.id);
    const category = this.readString(value.category);
    const summary = this.readString(value.summary);
    const hash = this.readString(value.hash);
    const visibility = this.readArtifactVisibility(value.visibility);
    if (!id || !category || !summary || !hash || !visibility) {
      return undefined;
    }
    return {
      id,
      category,
      summary,
      hash,
      ...(this.readString(value.version)
        ? { version: this.readString(value.version) }
        : {}),
      ...(this.readNonNegativeInteger(value.sizeBytes) !== undefined
        ? { sizeBytes: this.readNonNegativeInteger(value.sizeBytes) }
        : {}),
      ...(this.readString(value.replayKeyHint)
        ? { replayKeyHint: this.readString(value.replayKeyHint) }
        : {}),
      visibility,
      ...(this.readArtifactSensitivity(value.sensitivity)
        ? { sensitivity: this.readArtifactSensitivity(value.sensitivity) }
        : {}),
      ...(this.readStringArray(value.reasonCodes).length > 0
        ? { reasonCodes: this.readStringArray(value.reasonCodes) }
        : {}),
      ...(this.readStringArray(value.evidenceRefs).length > 0
        ? { evidenceRefs: this.readStringArray(value.evidenceRefs) }
        : {})
    };
  }

  private readSmartDefaults(
    value: unknown
  ): Text2SqlV2SmartDefaultsEvidenceV1 | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const bundleId = this.readString(value.bundleId);
    const version = this.readString(value.version);
    const coveredStages = this.readStageNameArray(value.coveredStages);
    const ruleIds = this.readStringArray(value.ruleIds);
    const status =
      value.status === "applied" || value.status === "fallback"
        ? value.status
        : undefined;
    if (
      !bundleId ||
      !version ||
      coveredStages.length === 0 ||
      ruleIds.length === 0 ||
      !status
    ) {
      return undefined;
    }
    const templateOverlay = this.readSmartDefaultsTemplateOverlay(
      value.templateOverlay
    );
    return {
      bundleId,
      version,
      coveredStages,
      ruleIds,
      status,
      ...(this.readString(value.fallbackReason)
        ? { fallbackReason: this.readString(value.fallbackReason) }
        : {}),
      ...(templateOverlay ? { templateOverlay } : {})
    };
  }

  private readSmartDefaultsTemplateOverlay(
    value: unknown
  ): Text2SqlV2SmartDefaultsEvidenceV1["templateOverlay"] | undefined {
    if (!this.isRecord(value) || typeof value.applied !== "boolean") {
      return undefined;
    }
    return {
      applied: value.applied,
      ...(this.readString(value.templateId)
        ? { templateId: this.readString(value.templateId) }
        : {}),
      ...(this.readPositiveInteger(value.version) !== undefined
        ? { version: this.readPositiveInteger(value.version) }
        : {})
    };
  }

  private normalizeCorrectionGrounding(
    value: unknown
  ): SqlCorrectionGroundingV1 | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }
    const failedSqlRef = this.readString(value.failedSqlRef);
    const retryReason = this.readString(value.retryReason);
    if (!failedSqlRef || !retryReason) {
      return undefined;
    }

    const failureCategory = this.readString(value.failureCategory);
    const source = this.readString(value.source);
    const semanticPlanRoute = this.readString(value.semanticPlanRoute);
    const semanticPlanRouteKind = this.readString(value.semanticPlanRouteKind);
    const contextPackStatus = this.readString(value.contextPackStatus);

    return {
      failedSqlRef,
      ...(this.readString(value.failedSqlPreview)
        ? {
            failedSqlPreview: this.readString(value.failedSqlPreview)
          }
        : {}),
      retryReason,
      ...(this.readString(value.failureCode)
        ? {
            failureCode: this.readString(value.failureCode)
          }
        : {}),
      ...(failureCategory &&
      (failureCategory === "validation" ||
        failureCategory === "governance" ||
        failureCategory === "safety" ||
        failureCategory === "provider" ||
        failureCategory === "execution" ||
        failureCategory === "unknown")
        ? {
            failureCategory
          }
        : {}),
      ...(source && (source === "validation" || source === "execution")
        ? {
            source
          }
        : {}),
      attemptCount: this.readNonNegativeInt(value.attemptCount),
      maxAttempts: this.readNonNegativeInt(value.maxAttempts),
      evidenceRefs: this.readStringArray(value.evidenceRefs),
      ...(this.readString(value.semanticPlanSnapshotId)
        ? {
            semanticPlanSnapshotId: this.readString(value.semanticPlanSnapshotId)
          }
        : {}),
      ...(semanticPlanRoute &&
      (semanticPlanRoute === "answer" ||
        semanticPlanRoute === "clarify" ||
        semanticPlanRoute === "reject")
        ? {
            semanticPlanRoute
          }
        : {}),
      ...(semanticPlanRouteKind &&
      (semanticPlanRouteKind === "text_to_sql" ||
        semanticPlanRouteKind === "metadata" ||
        semanticPlanRouteKind === "general" ||
        semanticPlanRouteKind === "clarify" ||
        semanticPlanRouteKind === "fail_closed")
        ? {
            semanticPlanRouteKind
          }
        : {}),
      ...(this.readNonNegativeInteger(value.selectedTableCount) !== undefined
        ? {
            selectedTableCount: this.readNonNegativeInteger(value.selectedTableCount)
          }
        : {}),
      ...(this.readNonNegativeInteger(value.selectedColumnCount) !== undefined
        ? {
            selectedColumnCount: this.readNonNegativeInteger(value.selectedColumnCount)
          }
        : {}),
      ...(contextPackStatus &&
      (contextPackStatus === "ready" || contextPackStatus === "degraded")
        ? {
            contextPackStatus
          }
        : {}),
      ...(this.readNonNegativeInteger(value.contextPackEvidenceCount) !== undefined
        ? {
            contextPackEvidenceCount: this.readNonNegativeInteger(
              value.contextPackEvidenceCount
            )
          }
        : {})
    };
  }

  private readSemanticPlanRouteKind(
    semanticPlan: Text2SqlV2RunArtifact["semanticPlan"] | undefined
  ): "text_to_sql" | "metadata" | "general" | "clarify" | "fail_closed" | undefined {
    const routeFilter = semanticPlan?.filters?.find((item) =>
      item.startsWith("route_kind:")
    );
    if (routeFilter) {
      const value = routeFilter.slice("route_kind:".length).trim();
      if (
        value === "text_to_sql" ||
        value === "metadata" ||
        value === "general" ||
        value === "clarify" ||
        value === "fail_closed"
      ) {
        return value;
      }
    }

    if (semanticPlan?.route === "clarify") {
      return "clarify";
    }
    if (semanticPlan?.route === "reject") {
      return "fail_closed";
    }
    return semanticPlan ? "text_to_sql" : undefined;
  }

  private readRouteKindFromIntakeStage(
    stages: Text2SqlV2RunArtifact["stages"] | undefined
  ): "text_to_sql" | "metadata" | "general" | "clarify" | "fail_closed" | undefined {
    if (!Array.isArray(stages)) {
      return undefined;
    }
    const intake = stages.find((stage) => stage.stage === "intake");
    if (!intake?.metadata || !this.isRecord(intake.metadata)) {
      return undefined;
    }
    const route = this.readString((intake.metadata as { route?: unknown }).route);
    if (
      route === "text_to_sql" ||
      route === "metadata" ||
      route === "general" ||
      route === "clarify" ||
      route === "fail_closed"
    ) {
      return route;
    }
    return undefined;
  }

  private readTraceV2Artifact(run: SqlRun): Text2SqlV2RunArtifact | undefined {
    const traceWithCompat = run.trace as SqlRun["trace"] & {
      v2?: unknown;
    };
    if (!this.isRecord(traceWithCompat.v2)) {
      return undefined;
    }
    const stages = (traceWithCompat.v2 as { stages?: unknown }).stages;
    if (!Array.isArray(stages)) {
      return undefined;
    }
    return traceWithCompat.v2 as Text2SqlV2RunArtifact;
  }

  private resolveTraceV2Failure(
    traceV2: Text2SqlV2RunArtifact
  ): NonNullable<NonNullable<DeliveryContract["evidence"]>["v2"]>["failure"] {
    for (let index = traceV2.stages.length - 1; index >= 0; index -= 1) {
      const stage = traceV2.stages[index];
      if (stage.status === "failed" && stage.failure) {
        return stage.failure;
      }
    }
    return traceV2.sqlValidation?.failure;
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
      value.triggerPath ?? value.triggerSource
    )?.toLowerCase();
    const triggerPath =
      triggerPathRaw === "rule" ||
      triggerPathRaw === "semantic" ||
      triggerPathRaw === "hybrid"
        ? (triggerPathRaw as ClarificationDecisionEvidence["triggerPath"])
        : undefined;
    const decisionSource = this.readString(
      value.decisionSource ?? value.source
    );
    const bypassed = this.readBoolean(value.bypassed ?? value.isBypassed);
    const bypassReasonCode = this.readString(value.bypassReasonCode);
    const confidenceLevelRaw = this.readString(
      value.confidenceLevel ?? value.confidence
    )?.toLowerCase();
    const confidenceLevel =
      confidenceLevelRaw === "high" ||
      confidenceLevelRaw === "medium" ||
      confidenceLevelRaw === "low"
        ? (confidenceLevelRaw as ClarificationDecisionEvidence["confidenceLevel"])
        : undefined;
    const missingCriticalSlots = this.readStringArray(
      value.missingCriticalSlots ?? value.missingSlots
    );
    const conflictDetected = this.readBoolean(
      value.conflictDetected ?? value.hasConflict
    );
    const reasonCodes = this.readStringArray(value.reasonCodes);
    const question = this.readString(
      value.question ?? value.clarificationQuestion ?? fallback?.question
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

  private readStageName(value: unknown): Text2SqlV2StageName | undefined {
    if (
      value === "intake" ||
      value === "retrieve" ||
      value === "assemble-context" ||
      value === "semantic-plan" ||
      value === "generate-sql" ||
      value === "validate" ||
      value === "correct" ||
      value === "execute" ||
      value === "answer"
    ) {
      return value;
    }
    return undefined;
  }

  private readStageNameArray(value: unknown): Text2SqlV2StageName[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is Text2SqlV2StageName =>
      Boolean(this.readStageName(item))
    );
  }

  private readRuntimePlanStatus(
    value: unknown
  ): Text2SqlV2RuntimePlanV1["items"][number]["status"] | undefined {
    if (
      value === "pending" ||
      value === "running" ||
      value === "completed" ||
      value === "skipped" ||
      value === "failed" ||
      value === "clarification"
    ) {
      return value;
    }
    return undefined;
  }

  private readArtifactVisibility(
    value: unknown
  ): Text2SqlV2ArtifactRefV1["visibility"] | undefined {
    if (value === "user" || value === "internal" || value === "redacted") {
      return value;
    }
    return undefined;
  }

  private readArtifactSensitivity(
    value: unknown
  ): Text2SqlV2ArtifactRefV1["sensitivity"] | undefined {
    if (
      value === "none" ||
      value === "permission_filtered" ||
      value === "provider_raw" ||
      value === "sensitive"
    ) {
      return value;
    }
    return undefined;
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
