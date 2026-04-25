import type {
  DeliveryArtifactLayer,
  DeliveryContract,
  DeliveryEvidenceLayer,
  ExecutionTraceStep,
  ReasoningStage,
  RunStatus,
  SqlRun
} from "@text2sql/shared-types";

export type RunVisibilityStatus = "loading" | "success" | "error" | "empty";

export type RunVisibilityThinkingStep = ExecutionTraceStep & {
  stage?: ReasoningStage;
  title?: string;
};

type JsonRecord = Record<string, unknown>;
type SavedPriorSqlLayer = NonNullable<DeliveryEvidenceLayer["savedPriorSql"]>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizeSelectedContext(value: unknown): DeliveryEvidenceLayer["selectedContext"] {
  if (Array.isArray(value)) {
    const snippets = value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (!isRecord(item)) {
          return undefined;
        }
        return (
          readString(item.snippet) ??
          readString(item.text) ??
          readString(item.content) ??
          readString(item.chunkId) ??
          readString(item.chunk_id)
        );
      })
      .filter((item): item is string => Boolean(item));
    return {
      count: value.length,
      snippets: snippets.length > 0 ? snippets : undefined
    };
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const rawCount = readNumber(value.count) ?? readNumber(value.contextCount);
  const count = rawCount !== undefined ? Math.max(0, Math.floor(rawCount)) : 0;
  const snippets = readStringArray(value.snippets);

  return {
    count,
    snippets: snippets.length > 0 ? snippets : undefined
  };
}

function normalizeSkillContextSummary(
  value: unknown
): DeliveryEvidenceLayer["skillContextSummary"] {
  if (!isRecord(value)) {
    return undefined;
  }

  const skills = Array.isArray(value.skills) ? value.skills.length : undefined;
  const contexts = Array.isArray(value.context) ? value.context.length : undefined;
  const skillCount = readNumber(value.skillCount) ?? readNumber(value.skill_count) ?? skills;
  const contextCount =
    readNumber(value.contextCount) ?? readNumber(value.context_count) ?? contexts;
  const degradeReason = readString(value.degradeReason) ?? readString(value.degrade_reason);

  if (skillCount === undefined && contextCount === undefined && !degradeReason) {
    return undefined;
  }

  return {
    skillCount: Math.max(0, Math.floor(skillCount ?? 0)),
    contextCount: Math.max(0, Math.floor(contextCount ?? 0)),
    degradeReason
  };
}

function normalizeEvidence(value: unknown): DeliveryEvidenceLayer | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const runId = readString(value.runId) ?? readString(value.run_id);
  if (!runId) {
    return undefined;
  }

  const degradeReasons = unique([
    ...readStringArray(value.degradeReasons),
    ...readStringArray(value.degrade_reasons),
    ...(readString(value.degrade_reason) ? [readString(value.degrade_reason)!] : [])
  ]);
  const selectedContext = normalizeSelectedContext(value.selectedContext ?? value.selected_context);
  const riskTags = unique([
    ...readStringArray(value.riskTags),
    ...readStringArray(value.risk_tags)
  ]);
  const retrievalLogsRaw = Array.isArray(value.retrievalLogs)
    ? value.retrievalLogs
    : Array.isArray(value.retrieval_logs)
      ? value.retrieval_logs
      : [];
  const retrievalLogs = retrievalLogsRaw
    .map((item) => {
      if (!isRecord(item)) {
        return undefined;
      }
      const replayKey = readString(item.replayKey) ?? readString(item.replay_key);
      const stage = readString(item.stage);
      const createdAt = readString(item.createdAt) ?? readString(item.created_at);
      if (!replayKey || !stage || !createdAt) {
        return undefined;
      }
      return {
        replayKey,
        stage,
        indexVersionId: readString(item.indexVersionId) ?? readString(item.index_version_id),
        createdAt
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const retrievalStatusRaw =
    readString(value.retrievalStatus) ?? readString(value.retrieval_status);
  const retrievalStatus =
    retrievalStatusRaw === "degraded" || retrievalStatusRaw === "ready"
      ? retrievalStatusRaw
      : undefined;
  const semanticVersionRaw =
    readNumber(value.semanticVersion) ?? readNumber(value.semantic_version);
  const semanticVersion =
    semanticVersionRaw !== undefined ? Math.max(0, Math.floor(semanticVersionRaw)) : undefined;
  const semanticLockStatusRaw =
    readString(value.semanticLockStatus) ?? readString(value.semantic_lock_status);
  const semanticLockStatus =
    semanticLockStatusRaw === "locked" ||
    semanticLockStatusRaw === "fallback" ||
    semanticLockStatusRaw === "degraded"
      ? semanticLockStatusRaw
      : undefined;
  const semanticDegradeReason =
    readString(value.semanticDegradeReason) ??
    readString(value.semantic_degrade_reason);
  const skillContextSummary = normalizeSkillContextSummary(
    value.skillContextSummary ?? value.skill_context_summary ?? value.skill_context
  );
  const evidenceStale = readBoolean(value.evidenceStale) ?? readBoolean(value.evidence_stale);
  const savedPriorSqlRaw = isRecord(value.savedPriorSql)
    ? value.savedPriorSql
    : isRecord(value.saved_prior_sql)
      ? value.saved_prior_sql
      : undefined;
  const savedPriorStatusRaw = readString(savedPriorSqlRaw?.status);
  const savedPriorStatus: SavedPriorSqlLayer["status"] | undefined =
    savedPriorStatusRaw === "hit" ||
    savedPriorStatusRaw === "miss" ||
    savedPriorStatusRaw === "filtered" ||
    savedPriorStatusRaw === "stale" ||
    savedPriorStatusRaw === "ambiguous"
      ? savedPriorStatusRaw
      : undefined;
  const savedPriorSafetyRaw = readString(
    savedPriorSqlRaw?.safetyResult ?? savedPriorSqlRaw?.safety_result
  );
  const savedPriorSafetyResult: SavedPriorSqlLayer["safetyResult"] | undefined =
    savedPriorSafetyRaw === "passed" ||
    savedPriorSafetyRaw === "rejected" ||
    savedPriorSafetyRaw === "fallback_generated"
      ? savedPriorSafetyRaw
      : undefined;
  const savedPriorShortcutUsed = readBoolean(
    savedPriorSqlRaw?.shortcutUsed ?? savedPriorSqlRaw?.shortcut_used
  );
  const savedPriorReasonCodes = unique([
    ...readStringArray(savedPriorSqlRaw?.reasonCodes),
    ...readStringArray(savedPriorSqlRaw?.reason_codes)
  ]);
  const savedPriorSql: SavedPriorSqlLayer | undefined =
    savedPriorStatus && savedPriorShortcutUsed !== undefined
      ? {
          status: savedPriorStatus,
          shortcutUsed: savedPriorShortcutUsed,
          ...(savedPriorReasonCodes.length > 0
            ? { reasonCodes: savedPriorReasonCodes }
            : {}),
          ...(readString(
            savedPriorSqlRaw?.selectedChunkId ?? savedPriorSqlRaw?.selected_chunk_id
          )
            ? {
                selectedChunkId: readString(
                  savedPriorSqlRaw?.selectedChunkId ??
                    savedPriorSqlRaw?.selected_chunk_id
                )
              }
            : {}),
          ...(readString(
            savedPriorSqlRaw?.selectedViewId ?? savedPriorSqlRaw?.selected_view_id
          )
            ? {
                selectedViewId: readString(
                  savedPriorSqlRaw?.selectedViewId ??
                    savedPriorSqlRaw?.selected_view_id
                )
              }
            : {}),
          ...(readString(
            savedPriorSqlRaw?.selectedViewName ?? savedPriorSqlRaw?.selected_view_name
          )
            ? {
                selectedViewName: readString(
                  savedPriorSqlRaw?.selectedViewName ??
                    savedPriorSqlRaw?.selected_view_name
                )
              }
            : {}),
          ...(readString(
            savedPriorSqlRaw?.selectedSourceRunId ??
              savedPriorSqlRaw?.selected_source_run_id
          )
            ? {
                selectedSourceRunId: readString(
                  savedPriorSqlRaw?.selectedSourceRunId ??
                    savedPriorSqlRaw?.selected_source_run_id
                )
              }
            : {}),
          ...(savedPriorSafetyResult ? { safetyResult: savedPriorSafetyResult } : {})
        }
      : undefined;

  const normalized: DeliveryEvidenceLayer = {
    runId,
    ...(retrievalStatus ? { retrievalStatus } : {}),
    ...(degradeReasons.length > 0 ? { degradeReasons } : {}),
    ...(selectedContext ? { selectedContext } : {}),
    ...(retrievalLogs.length > 0 ? { retrievalLogs } : {}),
    ...(riskTags.length > 0 ? { riskTags } : {}),
    ...(semanticVersion !== undefined ? { semanticVersion } : {}),
    ...(semanticLockStatus ? { semanticLockStatus } : {}),
    ...(semanticDegradeReason ? { semanticDegradeReason } : {}),
    ...(skillContextSummary ? { skillContextSummary } : {}),
    ...(savedPriorSql ? { savedPriorSql } : {}),
    ...(evidenceStale !== undefined ? { evidenceStale } : {})
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeArtifact(value: unknown): DeliveryArtifactLayer | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rowCountRaw = readNumber(value.rowCount) ?? readNumber(value.row_count);
  const hasError = readBoolean(value.hasError) ?? readBoolean(value.has_error);
  if (rowCountRaw === undefined || hasError === undefined) {
    return undefined;
  }

  const columns = readStringArray(value.columns);
  const rowsPreview = Array.isArray(value.rowsPreview)
    ? (value.rowsPreview.filter((item): item is Record<string, unknown> => isRecord(item)) as Array<
        Record<string, unknown>
      >)
    : Array.isArray(value.rows_preview)
      ? (value.rows_preview.filter((item): item is Record<string, unknown> => isRecord(item)) as Array<
          Record<string, unknown>
        >)
      : undefined;

  return {
    sql: readString(value.sql),
    columns: columns.length > 0 ? columns : undefined,
    rowCount: Math.max(0, Math.floor(rowCountRaw)),
    rowsPreview: rowsPreview && rowsPreview.length > 0 ? rowsPreview : undefined,
    hasError
  };
}

export function normalizeDeliveryContract(value: unknown): DeliveryContract | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const answerRaw = isRecord(value.answer) ? value.answer : undefined;
  if (!answerRaw) {
    return undefined;
  }

  const text = readString(answerRaw.text);
  const provider = readString(answerRaw.provider);
  const statusRaw = readString(answerRaw.status);
  const status: RunStatus =
    statusRaw === "clarification" ||
    statusRaw === "executionResult" ||
    statusRaw === "rejected" ||
    statusRaw === "failed"
      ? statusRaw
      : "executionResult";

  if (!text || !provider) {
    return undefined;
  }

  const evidence = normalizeEvidence(value.evidence);
  const artifact = normalizeArtifact(value.artifact);

  return {
    answer: {
      text,
      status,
      provider,
      model: readString(answerRaw.model)
    },
    ...(evidence ? { evidence } : {}),
    ...(artifact ? { artifact } : {})
  };
}

export function normalizeRunForVisibility(run: SqlRun): SqlRun {
  if (!run.delivery) {
    return run;
  }
  const normalizedDelivery = normalizeDeliveryContract(run.delivery);
  if (!normalizedDelivery) {
    return run;
  }
  return {
    ...run,
    delivery: normalizedDelivery
  };
}

function stepKey(step: RunVisibilityThinkingStep): string {
  return (
    step.stepId ??
    `${step.node}:${step.sequence ?? "na"}:${step.at ?? step.startedAt ?? step.endedAt ?? "na"}`
  );
}

export function mergeRunThinkingSteps(
  syncSteps: ExecutionTraceStep[] | undefined,
  streamSteps: RunVisibilityThinkingStep[] | undefined
): RunVisibilityThinkingStep[] {
  const merged = new Map<string, RunVisibilityThinkingStep>();

  for (const step of syncSteps ?? []) {
    merged.set(stepKey(step), step);
  }
  for (const step of streamSteps ?? []) {
    const key = stepKey(step);
    const current = merged.get(key);
    merged.set(key, current ? { ...current, ...step } : step);
  }

  return Array.from(merged.values()).sort((left, right) => {
    const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
    const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
    if (leftSequence !== rightSequence) {
      return leftSequence - rightSequence;
    }
    const leftTime = left.at ?? left.startedAt ?? left.endedAt ?? "";
    const rightTime = right.at ?? right.startedAt ?? right.endedAt ?? "";
    return leftTime.localeCompare(rightTime);
  });
}

export function toRunVisibilityStatusFromRunStatus(
  status: RunStatus | undefined
): RunVisibilityStatus | undefined {
  if (!status) {
    return undefined;
  }
  if (status === "failed" || status === "rejected") {
    return "error";
  }
  if (status === "clarification") {
    return "empty";
  }
  return "success";
}

export function transitionRunVisibilityStatus(
  previous: RunVisibilityStatus | undefined,
  next: RunVisibilityStatus | undefined
): RunVisibilityStatus | undefined {
  if (!next) {
    return previous;
  }
  if ((previous === "success" || previous === "error" || previous === "empty") && next === "loading") {
    return previous;
  }
  return next;
}

export function resolveRunVisibilityStatus(input: {
  runStatus?: RunStatus;
  streamStatus?: RunVisibilityStatus;
  activeStream?: boolean;
}): RunVisibilityStatus | undefined {
  let next = input.streamStatus;
  if (input.activeStream) {
    next = transitionRunVisibilityStatus(next, "loading");
  }
  if (input.runStatus) {
    next = transitionRunVisibilityStatus(
      next,
      toRunVisibilityStatusFromRunStatus(input.runStatus)
    );
  }
  return next;
}

export function resolveVisibleDelivery(input: {
  runDelivery?: unknown;
  streamDelivery?: unknown;
  answerText?: string;
  runStatus?: RunStatus;
  runProvider?: string;
  runModel?: string;
}): DeliveryContract | undefined {
  const fromRun = normalizeDeliveryContract(input.runDelivery);
  if (fromRun) {
    return fromRun;
  }
  const fromStream = normalizeDeliveryContract(input.streamDelivery);
  if (fromStream) {
    return fromStream;
  }
  const text = input.answerText?.trim();
  if (!text) {
    return undefined;
  }
  return {
    answer: {
      text,
      status: input.runStatus ?? "executionResult",
      provider: input.runProvider ?? "unknown",
      ...(input.runModel ? { model: input.runModel } : {})
    }
  };
}
