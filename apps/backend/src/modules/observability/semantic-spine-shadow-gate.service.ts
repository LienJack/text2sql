import { Injectable } from "@nestjs/common";

export interface SemanticSpineShadowSample {
  runId: string;
  datasourceId: string;
  accuracyLift: number;
  semanticConsistencyLift: number;
  latencyOverheadMs: number;
  degradeRate: number;
  recordedAt?: string;
}

interface SemanticSpineShadowRecord extends SemanticSpineShadowSample {
  recordedAt: string;
}

export interface SemanticSpineShadowGateReport {
  enabled: boolean;
  mode: "shadow" | "rollout";
  sampleSize: number;
  sampleReady: boolean;
  gatePass: boolean;
  reasons: string[];
  latest?: {
    runId: string;
    datasourceId: string;
    recordedAt: string;
    metrics: {
      accuracyLift: number;
      semanticConsistencyLift: number;
      latencyOverheadMs: number;
      degradeRate: number;
    };
  };
  metrics: {
    accuracyLiftAvg: number;
    semanticConsistencyLiftAvg: number;
    latencyP95OverheadMs: number;
    degradeRateAvg: number;
  };
  thresholds: {
    minSamples: number;
    minAccuracyLift: number;
    minSemanticConsistencyLift: number;
    maxLatencyOverheadMsP95: number;
    maxDegradeRate: number;
  };
  generatedAt: string;
}

@Injectable()
export class SemanticSpineShadowGateService {
  private readonly records: SemanticSpineShadowRecord[] = [];

  recordSample(input: SemanticSpineShadowSample): void {
    this.records.push({
      ...input,
      runId: input.runId.trim(),
      datasourceId: input.datasourceId.trim(),
      accuracyLift: this.normalizeRatio(input.accuracyLift),
      semanticConsistencyLift: this.normalizeRatio(input.semanticConsistencyLift),
      latencyOverheadMs: Math.max(0, input.latencyOverheadMs),
      degradeRate: this.normalizeRatio(input.degradeRate),
      recordedAt: this.normalizeIsoTimestamp(input.recordedAt)
    });
  }

  reset(): void {
    this.records.length = 0;
  }

  snapshot(): SemanticSpineShadowGateReport {
    const thresholds = this.readThresholds();
    const sampleSize = this.records.length;
    const sampleReady = sampleSize >= thresholds.minSamples;
    const latest = this.records.at(-1);
    const accuracyLiftAvg = this.average(this.records.map((item) => item.accuracyLift));
    const semanticConsistencyLiftAvg = this.average(
      this.records.map((item) => item.semanticConsistencyLift)
    );
    const latencyP95OverheadMs = this.percentile95(
      this.records.map((item) => item.latencyOverheadMs)
    );
    const degradeRateAvg = this.average(this.records.map((item) => item.degradeRate));

    const reasons: string[] = [];
    if (!sampleReady) {
      reasons.push("sample_not_ready");
    }
    if (sampleReady && accuracyLiftAvg < thresholds.minAccuracyLift) {
      reasons.push("accuracy_lift_below_threshold");
    }
    if (sampleReady && semanticConsistencyLiftAvg < thresholds.minSemanticConsistencyLift) {
      reasons.push("semantic_consistency_lift_below_threshold");
    }
    if (sampleReady && latencyP95OverheadMs > thresholds.maxLatencyOverheadMsP95) {
      reasons.push("latency_overhead_p95_exceeded");
    }
    if (sampleReady && degradeRateAvg > thresholds.maxDegradeRate) {
      reasons.push("degrade_rate_exceeded");
    }

    return {
      enabled: this.isSpineEnabled(),
      mode: this.isShadowMode() ? "shadow" : "rollout",
      sampleSize,
      sampleReady,
      gatePass: sampleReady && reasons.length === 0,
      reasons,
      latest: latest
        ? {
            runId: latest.runId,
            datasourceId: latest.datasourceId,
            recordedAt: latest.recordedAt,
            metrics: {
              accuracyLift: latest.accuracyLift,
              semanticConsistencyLift: latest.semanticConsistencyLift,
              latencyOverheadMs: latest.latencyOverheadMs,
              degradeRate: latest.degradeRate
            }
          }
        : undefined,
      metrics: {
        accuracyLiftAvg,
        semanticConsistencyLiftAvg,
        latencyP95OverheadMs,
        degradeRateAvg
      },
      thresholds,
      generatedAt: new Date().toISOString()
    };
  }

  private isSpineEnabled(): boolean {
    return process.env.AGENT_SML_SPINE_ENABLED === "true";
  }

  private isShadowMode(): boolean {
    return process.env.AGENT_SML_SPINE_SHADOW_ONLY !== "false";
  }

  private readThresholds(): SemanticSpineShadowGateReport["thresholds"] {
    return {
      minSamples: this.readNumber("AGENT_SML_SPINE_MIN_SAMPLES", 30),
      minAccuracyLift: this.readNumber("AGENT_SML_SPINE_MIN_ACCURACY_LIFT", 0.12),
      minSemanticConsistencyLift: this.readNumber(
        "AGENT_SML_SPINE_MIN_SEMANTIC_CONSISTENCY_LIFT",
        0.12
      ),
      maxLatencyOverheadMsP95: this.readNumber(
        "AGENT_SML_SPINE_MAX_LATENCY_OVERHEAD_MS_P95",
        180
      ),
      maxDegradeRate: this.readNumber("AGENT_SML_SPINE_MAX_DEGRADE_RATE", 0.1)
    };
  }

  private readNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return parsed;
  }

  private normalizeRatio(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    if (value < 0) {
      return 0;
    }
    if (value > 1) {
      return 1;
    }
    return Number(value.toFixed(6));
  }

  private normalizeIsoTimestamp(value?: string): string {
    const parsed = value ? Date.parse(value) : NaN;
    if (value && !Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
    return new Date().toISOString();
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    return Number((total / values.length).toFixed(6));
  }

  private percentile95(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    const selected = sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    return Number(selected.toFixed(3));
  }
}
