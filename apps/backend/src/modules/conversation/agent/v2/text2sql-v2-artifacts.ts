import type {
  Text2SqlV2FailureSemantic,
  Text2SqlV2RunArtifact,
  Text2SqlV2StageArtifact,
  Text2SqlV2StageName
} from "@text2sql/shared-types";
import { TEXT2SQL_V2_STAGE_ORDER } from "./text2sql-v2.types";

const nowIso = (): string => new Date().toISOString();

export const createText2SqlV2RunArtifact = (): Text2SqlV2RunArtifact => ({
  version: "v2",
  stageOrder: [...TEXT2SQL_V2_STAGE_ORDER],
  stages: []
});

export const startText2SqlV2Stage = (
  stage: Text2SqlV2StageName
): Text2SqlV2StageArtifact => ({
  stage,
  status: "success",
  startedAt: nowIso(),
  warnings: []
});

export const finishText2SqlV2Stage = (
  stage: Text2SqlV2StageArtifact,
  patch?: Partial<Text2SqlV2StageArtifact>
): Text2SqlV2StageArtifact => {
  const endedAt = patch?.endedAt ?? nowIso();
  const startedAt = patch?.startedAt ?? stage.startedAt;
  const durationMs =
    patch?.durationMs ??
    (startedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) : undefined);

  return {
    ...stage,
    ...patch,
    endedAt,
    durationMs,
    warnings: patch?.warnings ?? stage.warnings
  };
};

export const appendText2SqlV2Stage = (
  artifact: Text2SqlV2RunArtifact,
  stage: Text2SqlV2StageArtifact
): Text2SqlV2RunArtifact => ({
  ...artifact,
  stages: [...artifact.stages, stage]
});

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

