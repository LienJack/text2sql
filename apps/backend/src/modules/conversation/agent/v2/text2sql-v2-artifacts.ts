import type {
  Text2SqlV2FailureSemantic,
  Text2SqlV2LoopEvidence,
  Text2SqlV2ProviderMetadata,
  Text2SqlV2RunArtifact,
  Text2SqlV2StageArtifact,
  Text2SqlV2StageName,
  Text2SqlV2TerminationReason
} from "@text2sql/shared-types";
import { TEXT2SQL_V2_STAGE_ORDER } from "./text2sql-v2.types";

const nowIso = (): string => new Date().toISOString();

const mergeUnique = (
  current: string[] | undefined,
  next: string[] | undefined
): string[] | undefined => {
  const merged = [...(current ?? []), ...(next ?? [])]
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
};

const mergeMetadata = (
  current: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!current && !next) {
    return undefined;
  }
  return {
    ...(current ?? {}),
    ...(next ?? {})
  };
};

const cloneStageArtifact = (
  stage: Text2SqlV2StageArtifact
): Text2SqlV2StageArtifact => ({
  ...stage,
  ...(stage.warnings ? { warnings: [...stage.warnings] } : {}),
  ...(stage.evidenceIds ? { evidenceIds: [...stage.evidenceIds] } : {}),
  ...(stage.provider ? { provider: { ...stage.provider } } : {}),
  ...(stage.failure ? { failure: { ...stage.failure } } : {}),
  ...(stage.metadata ? { metadata: { ...stage.metadata } } : {})
});

const createSkippedStageArtifact = (
  stage: Text2SqlV2StageName
): Text2SqlV2StageArtifact => ({
  stage,
  status: "skipped"
});

export interface Text2SqlV2StageLifecycle {
  startStage: (input: {
    stage: Text2SqlV2StageName;
    provider?: Text2SqlV2ProviderMetadata;
    warnings?: string[];
    evidenceIds?: string[];
    metadata?: Record<string, unknown>;
  }) => Text2SqlV2StageArtifact;
  completeStage: (input: {
    stage: Text2SqlV2StageName;
    status?: Text2SqlV2StageArtifact["status"];
    provider?: Text2SqlV2ProviderMetadata;
    warnings?: string[];
    evidenceIds?: string[];
    failure?: Text2SqlV2FailureSemantic;
    metadata?: Record<string, unknown>;
  }) => Text2SqlV2StageArtifact;
  getStage: (stage: Text2SqlV2StageName) => Text2SqlV2StageArtifact | undefined;
  listStages: () => Text2SqlV2StageArtifact[];
  toRunArtifact: (input?: {
    contextPack?: Text2SqlV2RunArtifact["contextPack"];
    semanticPlan?: Text2SqlV2RunArtifact["semanticPlan"];
    sqlGeneration?: Text2SqlV2RunArtifact["sqlGeneration"];
    sqlValidation?: Text2SqlV2RunArtifact["sqlValidation"];
    loopEvidence?: Text2SqlV2LoopEvidence[];
    terminationReason?: Text2SqlV2TerminationReason;
  }) => Text2SqlV2RunArtifact;
}

const computeDurationMs = (
  startedAt: string | undefined,
  endedAt: string | undefined
): number | undefined => {
  if (!startedAt || !endedAt) {
    return undefined;
  }
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (Number.isNaN(started) || Number.isNaN(ended)) {
    return undefined;
  }
  return Math.max(0, ended - started);
};

export const createText2SqlV2StageLifecycle = (): Text2SqlV2StageLifecycle => {
  const stageMap = new Map<Text2SqlV2StageName, Text2SqlV2StageArtifact>();

  const upsert = (
    stage: Text2SqlV2StageName,
    patch: Partial<Text2SqlV2StageArtifact>
  ): Text2SqlV2StageArtifact => {
    const existing = stageMap.get(stage);
    const startedAt = patch.startedAt ?? existing?.startedAt;
    const endedAt = patch.endedAt ?? existing?.endedAt;
    const next: Text2SqlV2StageArtifact = {
      stage,
      status: patch.status ?? existing?.status ?? "success",
      startedAt,
      endedAt,
      durationMs:
        patch.durationMs ??
        computeDurationMs(startedAt, endedAt) ??
        existing?.durationMs,
      warnings: mergeUnique(existing?.warnings, patch.warnings),
      evidenceIds: mergeUnique(existing?.evidenceIds, patch.evidenceIds),
      provider: patch.provider ?? existing?.provider,
      failure: patch.failure ?? existing?.failure,
      metadata: mergeMetadata(existing?.metadata, patch.metadata)
    };
    stageMap.set(stage, next);
    return cloneStageArtifact(next);
  };

  return {
    startStage: (input) => {
      const current = stageMap.get(input.stage);
      const startedAt = current?.startedAt ?? nowIso();
      return upsert(input.stage, {
        status: current?.status ?? "success",
        startedAt,
        endedAt: undefined,
        durationMs: undefined,
        failure: undefined,
        provider: input.provider,
        warnings: input.warnings,
        evidenceIds: input.evidenceIds,
        metadata: input.metadata
      });
    },
    completeStage: (input) => {
      const current = stageMap.get(input.stage);
      const startedAt = current?.startedAt ?? nowIso();
      const endedAt = nowIso();
      return upsert(input.stage, {
        status: input.status ?? current?.status ?? "success",
        startedAt,
        endedAt,
        durationMs: computeDurationMs(startedAt, endedAt),
        provider: input.provider,
        warnings: input.warnings,
        evidenceIds: input.evidenceIds,
        failure: input.failure,
        metadata: input.metadata
      });
    },
    getStage: (stage) => {
      const current = stageMap.get(stage);
      return current ? cloneStageArtifact(current) : undefined;
    },
    listStages: () =>
      TEXT2SQL_V2_STAGE_ORDER.map(
        (stage) => stageMap.get(stage) ?? createSkippedStageArtifact(stage)
      ).map((item) => cloneStageArtifact(item)),
    toRunArtifact: (input) => ({
      version: "v2",
      stageOrder: [...TEXT2SQL_V2_STAGE_ORDER],
      stages: TEXT2SQL_V2_STAGE_ORDER.map(
        (stage) => stageMap.get(stage) ?? createSkippedStageArtifact(stage)
      ).map((item) => cloneStageArtifact(item)),
      contextPack: input?.contextPack,
      semanticPlan: input?.semanticPlan,
      sqlGeneration: input?.sqlGeneration,
      sqlValidation: input?.sqlValidation,
      loopEvidence: input?.loopEvidence ? [...input.loopEvidence] : undefined,
      terminationReason: input?.terminationReason
    })
  };
};

export const toText2SqlV2FailureSemantic = (
  error: unknown,
  options?: Partial<Text2SqlV2FailureSemantic>
): Text2SqlV2FailureSemantic => {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: options?.code ?? "TEXT2SQL_V2_STAGE_FAILED",
    message,
    category: options?.category ?? "unknown",
    terminal: options?.terminal ?? true,
    correctable: options?.correctable ?? false
  };
};
