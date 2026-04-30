import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import { RagReplayRepository } from "../observability/rag-replay.repository";

export interface RagQualityThresholds {
  recallAt20Min: number;
  mrrAt10Min: number;
  retrievalRerankP95MsMax: number;
  degradeRateMax: number;
  minSamples: number;
}

export interface RagQualityEvaluationInput {
  runId: string;
  datasourceId: string;
  sampleSize: number;
  recallAt20: number;
  mrrAt10: number;
  retrievalRerankP95Ms: number;
  degradeRate: number;
  priorSqlLane?: RagPriorSqlLaneMetricsInput;
  recordedAt?: string;
}

export interface RagPreparationPlaneMetricsInput {
  runId: string;
  datasourceId: string;
  manifestFingerprint?: string;
  activeIndexVersionId?: string;
  familyCounts?: Record<string, number>;
  preparedEntryCount?: number;
  degradedEntryCount?: number;
  skippedEntryCount?: number;
  permissionFilteredAssetCount?: number;
  selectedAssetCount?: number;
  staleReasons?: string[];
  lifecycleStatus?: string;
  recordedAt?: string;
}

export interface RagPriorSqlLaneMetricsInput {
  totalCount: number;
  hitCount: number;
  missCount?: number;
  filteredCount?: number;
  staleCount?: number;
  ambiguousCount?: number;
  duplicateCount?: number;
  safetyRejectedCount?: number;
  fallbackToGenerationCount?: number;
}

interface RagQualityEvaluationRecord extends RagQualityEvaluationInput {
  recordedAt: string;
  priorSqlLane?: RagPriorSqlLaneMetricsRecord;
}

interface RagPriorSqlLaneMetricsRecord {
  totalCount: number;
  hitCount: number;
  missCount: number;
  filteredCount: number;
  staleCount: number;
  ambiguousCount: number;
  duplicateCount: number;
  safetyRejectedCount: number;
  fallbackToGenerationCount: number;
}

interface RagPreparationPlaneMetricsRecord {
  runId: string;
  datasourceId: string;
  manifestFingerprint?: string;
  activeIndexVersionId?: string;
  familyCounts: Record<string, number>;
  preparedEntryCount: number;
  degradedEntryCount: number;
  skippedEntryCount: number;
  permissionFilteredAssetCount: number;
  selectedAssetCount: number;
  staleReasons: string[];
  lifecycleStatus?: string;
  recordedAt: string;
}

export interface RagPreparationPlaneGateReport {
  sampleSize: number;
  latestManifestFingerprint?: string;
  latestActiveIndexVersionId?: string;
  familyCounts: Record<string, number>;
  preparedEntryCount: number;
  degradedEntryCount: number;
  skippedEntryCount: number;
  permissionFilteredAssetCount: number;
  selectedAssetCount: number;
  staleReasons: string[];
  lifecycleStatuses: string[];
  completenessReady: boolean;
}

export interface RagDatasourceOrchestrationSample {
  datasourceId: string;
  workspaceId: string;
  queueWaitMs: number;
  isolationViolation: boolean;
  recordedAt?: string;
}

interface RagDatasourceOrchestrationRecord extends RagDatasourceOrchestrationSample {
  recordedAt: string;
}

export interface RagDatasourceOrchestrationReport {
  sampleSize24h: number;
  datasourceIsolationViolationCount: number;
  orchestratorQueueWaitP95Ms: number;
}

export interface RagCacheBudgetSample {
  cacheEligible: boolean;
  cacheHit: boolean;
  budgetDegraded: boolean;
  recordedAt?: string;
}

interface RagCacheBudgetRecord extends RagCacheBudgetSample {
  recordedAt: string;
}

export interface RagCacheBudgetReport {
  sampleSize1h: number;
  cacheEligibleHitRate: number;
  budgetDegradeRate: number;
}

type RagR6MetricComparator = "eq" | "gte" | "lte" | "bool";
type RagR6MetricAction = "block" | "freeze" | "rollback-observe";
type RagR6MetricState = "met" | "breach" | "insufficient_samples";

export interface RagR6MetricReport {
  name: string;
  value: number | boolean;
  threshold: string;
  window: string;
  minSamples: number;
  samples: number;
  met: boolean;
  action: RagR6MetricAction;
  state: RagR6MetricState;
}

export type RagR6GateDecision = "pass" | "freeze" | "block" | "rollback";

export interface RagR6GateReport {
  generatedAt: string;
  releaseCandidate: string;
  sampleReady: boolean;
  gatePass: boolean;
  gateDecision: RagR6GateDecision;
  metrics: RagR6MetricReport[];
  blockReasons: string[];
  freezeReasons: string[];
  rollbackReasons: string[];
  evidenceRefs: string[];
}

export interface RagReplayCompletenessReport {
  runId: string;
  requiredStages: string[];
  observedStages: string[];
  missingStages: string[];
  completeness: number;
  ready: boolean;
}

export interface RagQualityGateReport {
  thresholds: RagQualityThresholds;
  sampleSize: number;
  sampleReady: boolean;
  glossarySelectedContext: GlossarySelectedContextGateReport;
  datasourceOrchestration: RagDatasourceOrchestrationReport;
  cacheBudget: RagCacheBudgetReport;
  priorSqlLane: RagPriorSqlLaneGateReport;
  preparationPlane: RagPreparationPlaneGateReport;
  latest?: {
    runId: string;
    datasourceId: string;
    recordedAt: string;
    metrics: {
      recallAt20: number;
      mrrAt10: number;
      retrievalRerankP95Ms: number;
      degradeRate: number;
    };
  };
  gatePass: boolean;
  reasons: string[];
  r6: RagR6GateReport;
  generatedAt: string;
}

export interface RagPriorSqlLaneGateReport {
  sampleSize: number;
  priorSqlHitRate: number;
  priorSqlMissCount: number;
  priorSqlFilteredCount: number;
  priorSqlStaleRate: number;
  priorSqlAmbiguousCount: number;
  priorSqlDuplicateCount: number;
  priorSqlSafetyRejectedCount: number;
  priorSqlFallbackToGenerationCount: number;
}

interface GlossarySelectedContextSampleRow {
  sampleId: string;
  query: string;
  term: string;
  baselineSelectedContextHit?: boolean;
  glossarySelectedContextHit?: boolean;
}

interface GlossarySelectedContextFixture {
  version?: string;
  generatedAt?: string;
  baselineRunId?: string;
  candidateRunId?: string;
  samples?: GlossarySelectedContextSampleRow[];
}

type GlossarySelectedContextGateStatus =
  | "pass"
  | "fail"
  | "sample_not_ready"
  | "error";

export interface GlossarySelectedContextGateReport {
  status: GlossarySelectedContextGateStatus;
  pass: boolean;
  sampleVersion: string;
  sampleSize: number;
  minSamples: number;
  targetRelativeLift: number;
  baselineHitRate: number;
  glossaryHitRate: number;
  relativeLift: number;
  baselineRunId?: string;
  candidateRunId?: string;
  runId?: string;
  generatedAt: string;
  reasons: string[];
}

const DEFAULT_THRESHOLDS: RagQualityThresholds = {
  recallAt20Min: 0.8,
  mrrAt10Min: 0.65,
  retrievalRerankP95MsMax: 800,
  degradeRateMax: 0.05,
  minSamples: 30
};

const REQUIRED_REPLAY_STAGES = [
  "retrieval_lane",
  "retrieval_fused",
  "rerank_primary",
  "rerank_secondary",
  "rerank_finalized"
];

const GLOSSARY_SELECTED_CONTEXT_TARGET_RELATIVE_LIFT = 0.2;
const GLOSSARY_SELECTED_CONTEXT_MIN_SAMPLES = 100;
const GLOSSARY_SELECTED_CONTEXT_DEFAULT_FIXTURE_VERSION =
  "glossary-selected-context-v1";

interface RagR6MetricSpec {
  name: string;
  threshold: string;
  window: string;
  minSamples: number;
  comparator: RagR6MetricComparator;
  target: number | boolean;
  action: RagR6MetricAction;
}

const R6_EVIDENCE_REFS = [
  "data/reports/r6/gate-summary.json",
  "data/reports/r6/cache-budget-validation.json",
  "data/reports/r6/graph-fallback-chaos.json",
  "data/reports/r6/release-checklist.md",
  "data/reports/r6/rollback-rehearsal.md"
];

const R6_METRIC_SPECS: RagR6MetricSpec[] = [
  {
    name: "datasourceIsolationViolationCount",
    threshold: "== 0",
    window: "24h",
    minSamples: 100,
    comparator: "eq",
    target: 0,
    action: "block"
  },
  {
    name: "indexBuildSuccessRate",
    threshold: ">= 0.98",
    window: "24h",
    minSamples: 200,
    comparator: "gte",
    target: 0.98,
    action: "block"
  },
  {
    name: "orchestratorQueueWaitP95Ms",
    threshold: "<= 20000",
    window: "6h",
    minSamples: 500,
    comparator: "lte",
    target: 20000,
    action: "block"
  },
  {
    name: "retrievalP95Ms",
    threshold: "<= 700",
    window: "1h",
    minSamples: 1000,
    comparator: "lte",
    target: 700,
    action: "block"
  },
  {
    name: "cacheEligibleHitRate",
    threshold: ">= 0.55",
    window: "1h",
    minSamples: 500,
    comparator: "gte",
    target: 0.55,
    action: "freeze"
  },
  {
    name: "staleCacheReadRate",
    threshold: "<= 0.005",
    window: "24h",
    minSamples: 1000,
    comparator: "lte",
    target: 0.005,
    action: "block"
  },
  {
    name: "budgetDegradeRate",
    threshold: "<= 0.08",
    window: "1h",
    minSamples: 500,
    comparator: "lte",
    target: 0.08,
    action: "rollback-observe"
  },
  {
    name: "graphFallbackActivationRate",
    threshold: "<= 0.15",
    window: "1h",
    minSamples: 200,
    comparator: "lte",
    target: 0.15,
    action: "freeze"
  },
  {
    name: "securityGatePass",
    threshold: "== true",
    window: "release-check",
    minSamples: 1,
    comparator: "bool",
    target: true,
    action: "block"
  }
];

@Injectable()
export class RagQualityService {
  private readonly records: RagQualityEvaluationRecord[] = [];
  private readonly datasourceRecords: RagDatasourceOrchestrationRecord[] = [];
  private readonly cacheBudgetRecords: RagCacheBudgetRecord[] = [];
  private readonly preparationPlaneRecords: RagPreparationPlaneMetricsRecord[] = [];

  constructor(private readonly replayRepository: RagReplayRepository) {}

  recordEvaluation(input: RagQualityEvaluationInput): void {
    this.records.push({
      ...input,
      runId: input.runId.trim(),
      datasourceId: input.datasourceId.trim(),
      sampleSize: Math.max(0, Math.floor(input.sampleSize)),
      recallAt20: this.normalizeRatio(input.recallAt20),
      mrrAt10: this.normalizeRatio(input.mrrAt10),
      retrievalRerankP95Ms: Math.max(0, input.retrievalRerankP95Ms),
      degradeRate: this.normalizeRatio(input.degradeRate),
      priorSqlLane: this.normalizePriorSqlLaneMetrics(input.priorSqlLane),
      recordedAt: this.normalizeIsoTimestamp(input.recordedAt)
    });
  }

  reset(): void {
    this.records.length = 0;
    this.datasourceRecords.length = 0;
    this.cacheBudgetRecords.length = 0;
    this.preparationPlaneRecords.length = 0;
  }

  recordDatasourceOrchestration(input: RagDatasourceOrchestrationSample): void {
    const datasourceId = input.datasourceId.trim();
    const workspaceId = input.workspaceId.trim();
    if (!datasourceId || !workspaceId) {
      return;
    }
    this.datasourceRecords.push({
      datasourceId,
      workspaceId,
      queueWaitMs: Math.max(0, Number.isFinite(input.queueWaitMs) ? input.queueWaitMs : 0),
      isolationViolation: Boolean(input.isolationViolation),
      recordedAt: this.normalizeIsoTimestamp(input.recordedAt)
    });
  }

  recordCacheBudget(input: RagCacheBudgetSample): void {
    this.cacheBudgetRecords.push({
      cacheEligible: Boolean(input.cacheEligible),
      cacheHit: Boolean(input.cacheHit),
      budgetDegraded: Boolean(input.budgetDegraded),
      recordedAt: this.normalizeIsoTimestamp(input.recordedAt)
    });
  }

  recordPreparationPlane(input: RagPreparationPlaneMetricsInput): void {
    const runId = input.runId.trim();
    const datasourceId = input.datasourceId.trim();
    if (!runId || !datasourceId) {
      return;
    }
    const familyCounts = Object.fromEntries(
      Object.entries(input.familyCounts ?? {})
        .filter(([family, count]) => family.trim().length > 0 && Number.isFinite(count))
        .map(([family, count]) => [family, this.normalizeCount(count)])
    );
    this.preparationPlaneRecords.push({
      runId,
      datasourceId,
      manifestFingerprint: input.manifestFingerprint?.trim() || undefined,
      activeIndexVersionId: input.activeIndexVersionId?.trim() || undefined,
      familyCounts,
      preparedEntryCount: this.normalizeCount(input.preparedEntryCount),
      degradedEntryCount: this.normalizeCount(input.degradedEntryCount),
      skippedEntryCount: this.normalizeCount(input.skippedEntryCount),
      permissionFilteredAssetCount: this.normalizeCount(
        input.permissionFilteredAssetCount
      ),
      selectedAssetCount: this.normalizeCount(input.selectedAssetCount),
      staleReasons: this.unique(input.staleReasons ?? []),
      lifecycleStatus: input.lifecycleStatus?.trim() || undefined,
      recordedAt: this.normalizeIsoTimestamp(input.recordedAt)
    });
  }

  snapshot(): RagQualityGateReport {
    const latest = this.records.at(-1);
    const thresholds = DEFAULT_THRESHOLDS;
    const reasons: string[] = [];
    const sampleSize = latest?.sampleSize ?? 0;
    const sampleReady = sampleSize >= thresholds.minSamples;
    const glossarySelectedContext = this.snapshotGlossarySelectedContext(
      latest?.runId
    );

    if (!latest) {
      reasons.push("no_evaluation_data");
    } else {
      if (latest.recallAt20 < thresholds.recallAt20Min) {
        reasons.push("recall_below_threshold");
      }
      if (latest.mrrAt10 < thresholds.mrrAt10Min) {
        reasons.push("mrr_below_threshold");
      }
      if (latest.retrievalRerankP95Ms > thresholds.retrievalRerankP95MsMax) {
        reasons.push("p95_above_threshold");
      }
      if (latest.degradeRate > thresholds.degradeRateMax) {
        reasons.push("degrade_rate_above_threshold");
      }
      if (!sampleReady) {
        reasons.push("sample_not_ready");
      }
    }

    const r6 = this.snapshotR6(latest);

    return {
      thresholds,
      sampleSize,
      sampleReady,
      glossarySelectedContext,
      datasourceOrchestration: this.snapshotDatasourceOrchestration(),
      cacheBudget: this.snapshotCacheBudget(),
      priorSqlLane: this.snapshotPriorSqlLane(),
      preparationPlane: this.snapshotPreparationPlane(),
      latest: latest
        ? {
            runId: latest.runId,
            datasourceId: latest.datasourceId,
            recordedAt: latest.recordedAt,
            metrics: {
              recallAt20: latest.recallAt20,
              mrrAt10: latest.mrrAt10,
              retrievalRerankP95Ms: latest.retrievalRerankP95Ms,
              degradeRate: latest.degradeRate
            }
          }
        : undefined,
      gatePass: sampleReady && reasons.length === 0,
      reasons,
      r6,
      generatedAt: new Date().toISOString()
    };
  }

  async getReplayCompleteness(runId: string): Promise<RagReplayCompletenessReport> {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return {
        runId: "",
        requiredStages: [...REQUIRED_REPLAY_STAGES],
        observedStages: [],
        missingStages: [...REQUIRED_REPLAY_STAGES],
        completeness: 0,
        ready: false
      };
    }
    const replayEvents = await this.replayRepository.listByRunId(normalizedRunId);
    const observedStages = Array.from(new Set(replayEvents.map((item) => item.stage)));
    const missingStages = REQUIRED_REPLAY_STAGES.filter(
      (stage) => !observedStages.includes(stage)
    );
    const completeness =
      REQUIRED_REPLAY_STAGES.length === 0
        ? 1
        : (REQUIRED_REPLAY_STAGES.length - missingStages.length) /
          REQUIRED_REPLAY_STAGES.length;
    return {
      runId: normalizedRunId,
      requiredStages: [...REQUIRED_REPLAY_STAGES],
      observedStages,
      missingStages,
      completeness: Number(completeness.toFixed(6)),
      ready: missingStages.length === 0
    };
  }

  private snapshotGlossarySelectedContext(
    latestRunId: string | undefined
  ): GlossarySelectedContextGateReport {
    const generatedAt = new Date().toISOString();
    const fixturePath = this.getGlossarySelectedContextFixturePath();
    if (!existsSync(fixturePath)) {
      return {
        status: "sample_not_ready",
        pass: false,
        sampleVersion: GLOSSARY_SELECTED_CONTEXT_DEFAULT_FIXTURE_VERSION,
        sampleSize: 0,
        minSamples: GLOSSARY_SELECTED_CONTEXT_MIN_SAMPLES,
        targetRelativeLift: GLOSSARY_SELECTED_CONTEXT_TARGET_RELATIVE_LIFT,
        baselineHitRate: 0,
        glossaryHitRate: 0,
        relativeLift: 0,
        runId: latestRunId,
        generatedAt,
        reasons: ["fixture_not_found"]
      };
    }

    let fixture: GlossarySelectedContextFixture;
    try {
      const raw = readFileSync(fixturePath, "utf-8");
      fixture = JSON.parse(raw) as GlossarySelectedContextFixture;
    } catch (_error) {
      return {
        status: "error",
        pass: false,
        sampleVersion: GLOSSARY_SELECTED_CONTEXT_DEFAULT_FIXTURE_VERSION,
        sampleSize: 0,
        minSamples: GLOSSARY_SELECTED_CONTEXT_MIN_SAMPLES,
        targetRelativeLift: GLOSSARY_SELECTED_CONTEXT_TARGET_RELATIVE_LIFT,
        baselineHitRate: 0,
        glossaryHitRate: 0,
        relativeLift: 0,
        runId: latestRunId,
        generatedAt,
        reasons: ["fixture_parse_failed"]
      };
    }

    const samples = Array.isArray(fixture.samples) ? fixture.samples : [];
    const sampleVersion =
      typeof fixture.version === "string" && fixture.version.trim().length > 0
        ? fixture.version.trim()
        : GLOSSARY_SELECTED_CONTEXT_DEFAULT_FIXTURE_VERSION;
    const baselineRunId =
      typeof fixture.baselineRunId === "string" && fixture.baselineRunId.trim().length > 0
        ? fixture.baselineRunId.trim()
        : undefined;
    const candidateRunId =
      typeof fixture.candidateRunId === "string" && fixture.candidateRunId.trim().length > 0
        ? fixture.candidateRunId.trim()
        : undefined;
    const reasons: string[] = [];

    if (samples.length < GLOSSARY_SELECTED_CONTEXT_MIN_SAMPLES) {
      reasons.push("sample_count_below_minimum");
    }

    const baselineSampleSize = samples.filter(
      (sample) => typeof sample.baselineSelectedContextHit === "boolean"
    ).length;
    const glossarySampleSize = samples.filter(
      (sample) => typeof sample.glossarySelectedContextHit === "boolean"
    ).length;
    if (baselineSampleSize === 0) {
      reasons.push("baseline_not_ready");
    }
    if (glossarySampleSize === 0) {
      reasons.push("candidate_not_ready");
    }

    const baselineHitRate = this.computeGlossaryHitRate(samples, "baseline");
    const glossaryHitRate = this.computeGlossaryHitRate(samples, "candidate");
    const relativeLift =
      baselineHitRate <= 0
        ? 0
        : Number(((glossaryHitRate - baselineHitRate) / baselineHitRate).toFixed(6));

    if (baselineHitRate <= 0) {
      reasons.push("baseline_zero_hit_rate");
    }

    const sampleNotReady = reasons.length > 0;
    if (sampleNotReady) {
      return {
        status: "sample_not_ready",
        pass: false,
        sampleVersion,
        sampleSize: samples.length,
        minSamples: GLOSSARY_SELECTED_CONTEXT_MIN_SAMPLES,
        targetRelativeLift: GLOSSARY_SELECTED_CONTEXT_TARGET_RELATIVE_LIFT,
        baselineHitRate,
        glossaryHitRate,
        relativeLift,
        baselineRunId,
        candidateRunId,
        runId: latestRunId ?? candidateRunId ?? baselineRunId,
        generatedAt,
        reasons
      };
    }

    const pass =
      relativeLift >= GLOSSARY_SELECTED_CONTEXT_TARGET_RELATIVE_LIFT;
    return {
      status: pass ? "pass" : "fail",
      pass,
      sampleVersion,
      sampleSize: samples.length,
      minSamples: GLOSSARY_SELECTED_CONTEXT_MIN_SAMPLES,
      targetRelativeLift: GLOSSARY_SELECTED_CONTEXT_TARGET_RELATIVE_LIFT,
      baselineHitRate,
      glossaryHitRate,
      relativeLift,
      baselineRunId,
      candidateRunId,
      runId: latestRunId ?? candidateRunId ?? baselineRunId,
      generatedAt,
      reasons: pass ? [] : ["relative_lift_below_target"]
    };
  }

  private computeGlossaryHitRate(
    samples: GlossarySelectedContextSampleRow[],
    lane: "baseline" | "candidate"
  ): number {
    const key =
      lane === "baseline" ? "baselineSelectedContextHit" : "glossarySelectedContextHit";
    const eligible = samples.filter((sample) => typeof sample[key] === "boolean");
    if (eligible.length === 0) {
      return 0;
    }
    const hits = eligible.filter((sample) => sample[key] === true).length;
    return Number((hits / eligible.length).toFixed(6));
  }

  private getGlossarySelectedContextFixturePath(): string {
    const fromEnv = process.env.GLOSSARY_SELECTED_CONTEXT_FIXTURE_PATH?.trim();
    if (fromEnv) {
      return resolve(process.cwd(), fromEnv);
    }
    return resolve(process.cwd(), "test/fixtures/glossary-selected-context-samples.json");
  }

  private normalizeIsoTimestamp(input?: string): string {
    if (!input) {
      return new Date().toISOString();
    }
    const parsed = Date.parse(input);
    if (Number.isNaN(parsed)) {
      return new Date().toISOString();
    }
    return new Date(parsed).toISOString();
  }

  private normalizeRatio(input: number): number {
    if (!Number.isFinite(input)) {
      return 0;
    }
    return Math.max(0, Math.min(1, Number(input.toFixed(6))));
  }

  private normalizeCount(input: number | undefined): number {
    if (input === undefined || !Number.isFinite(input)) {
      return 0;
    }
    return Math.max(0, Math.floor(input));
  }

  private normalizePriorSqlLaneMetrics(
    input: RagPriorSqlLaneMetricsInput | undefined
  ): RagPriorSqlLaneMetricsRecord | undefined {
    if (!input) {
      return undefined;
    }
    const totalCount = this.normalizeCount(input.totalCount);
    const hitCount = Math.min(totalCount, this.normalizeCount(input.hitCount));
    const filteredCount = this.normalizeCount(input.filteredCount);
    const staleCount = Math.min(totalCount, this.normalizeCount(input.staleCount));
    const ambiguousCount = this.normalizeCount(input.ambiguousCount);
    const duplicateCount = this.normalizeCount(input.duplicateCount);
    const safetyRejectedCount = this.normalizeCount(input.safetyRejectedCount);
    const fallbackToGenerationCount = this.normalizeCount(
      input.fallbackToGenerationCount
    );
    const missCount = Math.max(
      0,
      this.normalizeCount(input.missCount) ||
        totalCount - hitCount - filteredCount - staleCount - ambiguousCount
    );
    return {
      totalCount,
      hitCount,
      missCount,
      filteredCount,
      staleCount,
      ambiguousCount,
      duplicateCount,
      safetyRejectedCount,
      fallbackToGenerationCount
    };
  }

  private snapshotDatasourceOrchestration(): RagDatasourceOrchestrationReport {
    const now = Date.now();
    const last24h = this.datasourceRecords.filter(
      (item) => now - Date.parse(item.recordedAt) <= 24 * 60 * 60 * 1000
    );
    const last6hQueueWaits = this.datasourceRecords
      .filter((item) => now - Date.parse(item.recordedAt) <= 6 * 60 * 60 * 1000)
      .map((item) => item.queueWaitMs);

    return {
      sampleSize24h: last24h.length,
      datasourceIsolationViolationCount: last24h.filter((item) => item.isolationViolation)
        .length,
      orchestratorQueueWaitP95Ms: this.percentile(last6hQueueWaits, 0.95)
    };
  }

  private snapshotCacheBudget(): RagCacheBudgetReport {
    const now = Date.now();
    const samples = this.cacheBudgetRecords.filter(
      (item) => now - Date.parse(item.recordedAt) <= 60 * 60 * 1000
    );
    const eligible = samples.filter((item) => item.cacheEligible);
    const eligibleHits = eligible.filter((item) => item.cacheHit).length;
    const degraded = samples.filter((item) => item.budgetDegraded).length;
    return {
      sampleSize1h: samples.length,
      cacheEligibleHitRate:
        eligible.length === 0 ? 0 : Number((eligibleHits / eligible.length).toFixed(6)),
      budgetDegradeRate:
        samples.length === 0 ? 0 : Number((degraded / samples.length).toFixed(6))
    };
  }

  private snapshotPriorSqlLane(): RagPriorSqlLaneGateReport {
    const summary = this.records.reduce(
      (accumulator, record) => {
        if (!record.priorSqlLane) {
          return accumulator;
        }
        return {
          totalCount: accumulator.totalCount + record.priorSqlLane.totalCount,
          hitCount: accumulator.hitCount + record.priorSqlLane.hitCount,
          missCount: accumulator.missCount + record.priorSqlLane.missCount,
          filteredCount: accumulator.filteredCount + record.priorSqlLane.filteredCount,
          staleCount: accumulator.staleCount + record.priorSqlLane.staleCount,
          ambiguousCount:
            accumulator.ambiguousCount + record.priorSqlLane.ambiguousCount,
          duplicateCount:
            accumulator.duplicateCount + record.priorSqlLane.duplicateCount,
          safetyRejectedCount:
            accumulator.safetyRejectedCount +
            record.priorSqlLane.safetyRejectedCount,
          fallbackToGenerationCount:
            accumulator.fallbackToGenerationCount +
            record.priorSqlLane.fallbackToGenerationCount
        };
      },
      {
        totalCount: 0,
        hitCount: 0,
        missCount: 0,
        filteredCount: 0,
        staleCount: 0,
        ambiguousCount: 0,
        duplicateCount: 0,
        safetyRejectedCount: 0,
        fallbackToGenerationCount: 0
      }
    );
    return {
      sampleSize: summary.totalCount,
      priorSqlHitRate:
        summary.totalCount === 0
          ? 0
          : Number((summary.hitCount / summary.totalCount).toFixed(6)),
      priorSqlMissCount: summary.missCount,
      priorSqlFilteredCount: summary.filteredCount,
      priorSqlStaleRate:
        summary.totalCount === 0
          ? 0
          : Number((summary.staleCount / summary.totalCount).toFixed(6)),
      priorSqlAmbiguousCount: summary.ambiguousCount,
      priorSqlDuplicateCount: summary.duplicateCount,
      priorSqlSafetyRejectedCount: summary.safetyRejectedCount,
      priorSqlFallbackToGenerationCount: summary.fallbackToGenerationCount
    };
  }

  private snapshotPreparationPlane(): RagPreparationPlaneGateReport {
    const latest = this.preparationPlaneRecords.at(-1);
    const familyCounts = new Map<string, number>();
    let preparedEntryCount = 0;
    let degradedEntryCount = 0;
    let skippedEntryCount = 0;
    let permissionFilteredAssetCount = 0;
    let selectedAssetCount = 0;
    const staleReasons: string[] = [];
    const lifecycleStatuses: string[] = [];

    for (const record of this.preparationPlaneRecords) {
      for (const [family, count] of Object.entries(record.familyCounts)) {
        familyCounts.set(family, (familyCounts.get(family) ?? 0) + count);
      }
      preparedEntryCount += record.preparedEntryCount;
      degradedEntryCount += record.degradedEntryCount;
      skippedEntryCount += record.skippedEntryCount;
      permissionFilteredAssetCount += record.permissionFilteredAssetCount;
      selectedAssetCount += record.selectedAssetCount;
      staleReasons.push(...record.staleReasons);
      if (record.lifecycleStatus) {
        lifecycleStatuses.push(record.lifecycleStatus);
      }
    }

    return {
      sampleSize: this.preparationPlaneRecords.length,
      latestManifestFingerprint: latest?.manifestFingerprint,
      latestActiveIndexVersionId: latest?.activeIndexVersionId,
      familyCounts: Object.fromEntries([...familyCounts.entries()].sort()),
      preparedEntryCount,
      degradedEntryCount,
      skippedEntryCount,
      permissionFilteredAssetCount,
      selectedAssetCount,
      staleReasons: this.unique(staleReasons),
      lifecycleStatuses: this.unique(lifecycleStatuses),
      completenessReady:
        this.preparationPlaneRecords.length > 0 &&
        preparedEntryCount > 0 &&
        this.unique(staleReasons).length === 0
    };
  }

  private percentile(values: number[], quantile: number): number {
    if (values.length === 0) {
      return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * quantile) - 1)
    );
    const value = sorted[index];
    return Number.isFinite(value) ? Number(value.toFixed(3)) : 0;
  }

  private unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0))).sort();
  }

  private snapshotR6(
    latest: RagQualityEvaluationRecord | undefined
  ): RagR6GateReport {
    const nowIso = new Date().toISOString();
    const datasource = this.snapshotDatasourceOrchestration();
    const cacheBudget = this.snapshotCacheBudget();
    const datasourceSamples = datasource.sampleSize24h;
    const cacheSamples = cacheBudget.sampleSize1h;
    const retrievalSamples = latest?.sampleSize ?? 0;
    const indexBuildSuccessRate =
      datasourceSamples === 0
        ? 0
        : Number(
            (
              (datasourceSamples - datasource.datasourceIsolationViolationCount) /
              datasourceSamples
            ).toFixed(6)
          );
    const metricValues = new Map<string, { value: number | boolean; samples: number }>([
      [
        "datasourceIsolationViolationCount",
        {
          value: datasource.datasourceIsolationViolationCount,
          samples: datasourceSamples
        }
      ],
      [
        "indexBuildSuccessRate",
        {
          value: indexBuildSuccessRate,
          samples: datasourceSamples
        }
      ],
      [
        "orchestratorQueueWaitP95Ms",
        {
          value: datasource.orchestratorQueueWaitP95Ms,
          samples: datasourceSamples
        }
      ],
      [
        "retrievalP95Ms",
        {
          value: latest?.retrievalRerankP95Ms ?? 0,
          samples: retrievalSamples
        }
      ],
      [
        "cacheEligibleHitRate",
        {
          value: cacheBudget.cacheEligibleHitRate,
          samples: cacheSamples
        }
      ],
      [
        "staleCacheReadRate",
        {
          value: 0,
          samples: cacheSamples
        }
      ],
      [
        "budgetDegradeRate",
        {
          value: cacheBudget.budgetDegradeRate,
          samples: cacheSamples
        }
      ],
      [
        "graphFallbackActivationRate",
        {
          value: 0,
          samples: Math.max(retrievalSamples, cacheSamples)
        }
      ],
      [
        "securityGatePass",
        {
          value: true,
          samples: 1
        }
      ]
    ]);

    const metrics = R6_METRIC_SPECS.map((metric) => {
      const entry = metricValues.get(metric.name);
      return this.evaluateR6Metric(metric, entry?.value ?? 0, entry?.samples ?? 0);
    });
    const blockReasons = metrics
      .filter((metric) => metric.action === "block" && metric.state === "breach")
      .map((metric) => `${metric.name}_breach`);
    const freezeReasons = metrics
      .filter((metric) => metric.action === "freeze" && metric.state === "breach")
      .map((metric) => `${metric.name}_breach`);
    const rollbackReasons = metrics
      .filter(
        (metric) => metric.action === "rollback-observe" && metric.state === "breach"
      )
      .map((metric) => `${metric.name}_breach`);
    const sampleReady = metrics.every((metric) => metric.samples >= metric.minSamples);
    if (!sampleReady) {
      blockReasons.unshift("sample_not_ready");
    }

    let gateDecision: RagR6GateDecision = "pass";
    if (blockReasons.length > 0) {
      gateDecision = "block";
    } else if (rollbackReasons.length > 0) {
      gateDecision = "rollback";
    } else if (freezeReasons.length > 0) {
      gateDecision = "freeze";
    }

    return {
      generatedAt: nowIso,
      releaseCandidate: process.env.RELEASE_CANDIDATE?.trim() || "r6-local",
      sampleReady,
      gatePass: sampleReady && gateDecision === "pass",
      gateDecision,
      metrics,
      blockReasons,
      freezeReasons: [...freezeReasons],
      rollbackReasons: [...rollbackReasons],
      evidenceRefs: [...R6_EVIDENCE_REFS]
    };
  }

  private evaluateR6Metric(
    spec: RagR6MetricSpec,
    value: number | boolean,
    samples: number
  ): RagR6MetricReport {
    const sampleReady = samples >= spec.minSamples;
    const met = sampleReady ? this.matchR6Threshold(spec, value) : false;
    return {
      name: spec.name,
      value,
      threshold: spec.threshold,
      window: spec.window,
      minSamples: spec.minSamples,
      samples,
      met,
      action: spec.action,
      state: !sampleReady ? "insufficient_samples" : met ? "met" : "breach"
    };
  }

  private matchR6Threshold(spec: RagR6MetricSpec, value: number | boolean): boolean {
    switch (spec.comparator) {
      case "eq":
        return Number(value) === Number(spec.target);
      case "gte":
        return Number(value) >= Number(spec.target);
      case "lte":
        return Number(value) <= Number(spec.target);
      case "bool":
        return Boolean(value) === Boolean(spec.target);
      default:
        return false;
    }
  }
}
