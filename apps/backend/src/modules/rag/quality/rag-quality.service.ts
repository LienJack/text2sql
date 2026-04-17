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

@Injectable()
export class RagQualityService {
  private readonly records: RagQualityEvaluationRecord[] = [];

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

    return {
      thresholds,
      sampleSize,
      sampleReady,
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
}
