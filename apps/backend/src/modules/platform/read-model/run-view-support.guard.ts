import type { SqlRun } from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";

interface V2TraceStageShape {
  stage?: unknown;
}

interface RunReadModelTraceShape {
  v2?: {
    version?: unknown;
    stageOrder?: unknown;
    stages?: unknown;
  };
}

type SupportedV2ReadRun = Pick<SqlRun, "runId" | "trace"> | {
  runId: string;
  trace?: RunReadModelTraceShape;
};

export interface AssertSupportedV2RunReadOptions {
  unsupportedMessage: string;
}

const LEGACY_REQUIRED_MARKERS = {
  version: "run.trace.v2.version === 'v2'",
  stageOrder: "run.trace.v2.stageOrder.length > 0",
  stageArtifacts: "run.trace.v2.stages.length > 0"
} as const;

export function assertSupportedV2RunReadModel(
  run: SupportedV2ReadRun,
  options: AssertSupportedV2RunReadOptions
): void {
  if (isSupportedV2RunReadModel(run)) {
    return;
  }
  throw new DomainError(
    "LEGACY_RUN_UNSUPPORTED",
    options.unsupportedMessage,
    410,
    {
      runId: run.runId,
      expectedContract: "text2sql-v2-read-model",
      requiredMarkers: LEGACY_REQUIRED_MARKERS,
      migrationRunbook: "docs/runbooks/text2sql-v2-hardcut-read-model-migration.md"
    }
  );
}

export function isSupportedV2RunReadModel(run: Pick<SupportedV2ReadRun, "trace">): boolean {
  const traceV2 = run.trace?.v2;
  if (!traceV2 || traceV2.version !== "v2") {
    return false;
  }
  const stageOrder = traceV2.stageOrder;
  if (!Array.isArray(stageOrder) || stageOrder.length === 0) {
    return false;
  }
  const stages = traceV2.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    return false;
  }
  return stages.every(
    (stage): stage is V2TraceStageShape =>
      typeof stage === "object" &&
      stage !== null &&
      typeof (stage as V2TraceStageShape).stage === "string" &&
      stageOrder.includes((stage as V2TraceStageShape).stage as string)
  );
}
