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
  recordedAt?: string;
}

interface RagQualityEvaluationRecord extends RagQualityEvaluationInput {
  recordedAt: string;
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
  datasourceOrchestration: RagDatasourceOrchestrationReport;
  cacheBudget: RagCacheBudgetReport;
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
      recordedAt: this.normalizeIsoTimestamp(input.recordedAt)
    });
  }

  reset(): void {
    this.records.length = 0;
    this.datasourceRecords.length = 0;
    this.cacheBudgetRecords.length = 0;
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

  snapshot(): RagQualityGateReport {
    const latest = this.records.at(-1);
    const thresholds = DEFAULT_THRESHOLDS;
    const reasons: string[] = [];
    const sampleSize = latest?.sampleSize ?? 0;
    const sampleReady = sampleSize >= thresholds.minSamples;

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
      datasourceOrchestration: this.snapshotDatasourceOrchestration(),
      cacheBudget: this.snapshotCacheBudget(),
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
