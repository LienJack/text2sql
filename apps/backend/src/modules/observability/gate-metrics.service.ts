import { Injectable } from "@nestjs/common";
import type { RunStatus } from "@text2sql/shared-types";
import { AppConfigService } from "../config/app-config.service";

interface GateMetricEvent {
  at: number;
  status: RunStatus;
  errorCategory?: string;
  blockedByPolicy: boolean;
}

export interface GateMetricInput {
  status: RunStatus;
  error?: string;
  at?: string;
}

export interface GateMetricsSnapshot {
  windowMinutes: number;
  observedRuns: number;
  successRate: number;
  rejectionRate: number;
  hardFailureRate: number;
  blockedByPolicy: number;
  errorCategories: Record<string, number>;
  thresholds: {
    minSuccessRate: number;
    maxRejectionRate: number;
    maxHardFailureRate: number;
    minSamples: number;
  };
  sampleReady: boolean;
  gatePass: boolean;
  generatedAt: string;
}

@Injectable()
export class GateMetricsService {
  private readonly events: GateMetricEvent[] = [];

  constructor(private readonly config: AppConfigService) {}

  recordOutcome(input: GateMetricInput): void {
    const atMs = input.at ? Date.parse(input.at) : Date.now();
    const event: GateMetricEvent = {
      at: Number.isNaN(atMs) ? Date.now() : atMs,
      status: input.status,
      blockedByPolicy: input.status === "rejected",
      errorCategory: this.resolveErrorCategory(input.status, input.error)
    };
    this.events.push(event);
    this.prune(event.at);
  }

  snapshot(now = Date.now()): GateMetricsSnapshot {
    this.prune(now);
    const total = this.events.length;
    const success = this.events.filter(
      (event) => event.status === "executionResult" || event.status === "clarification"
    ).length;
    const rejected = this.events.filter((event) => event.status === "rejected").length;
    const failed = this.events.filter((event) => event.status === "failed").length;
    const blockedByPolicy = this.events.filter((event) => event.blockedByPolicy).length;
    const errorCategories: Record<string, number> = {};
    for (const event of this.events) {
      if (!event.errorCategory) {
        continue;
      }
      errorCategories[event.errorCategory] =
        (errorCategories[event.errorCategory] ?? 0) + 1;
    }

    const successRate = total === 0 ? 0 : success / total;
    const rejectionRate = total === 0 ? 0 : rejected / total;
    const hardFailureRate = total === 0 ? 0 : failed / total;
    const thresholds = {
      minSuccessRate: this.config.r1GateMinSuccessRate,
      maxRejectionRate: this.config.r1GateMaxRejectionRate,
      maxHardFailureRate: this.config.r1GateMaxHardFailureRate,
      minSamples: this.config.r1GateMinSamples
    };
    const sampleReady = total >= thresholds.minSamples;
    const gatePass =
      sampleReady &&
      successRate >= thresholds.minSuccessRate &&
      rejectionRate <= thresholds.maxRejectionRate &&
      hardFailureRate <= thresholds.maxHardFailureRate;

    return {
      windowMinutes: this.config.r1GateWindowMinutes,
      observedRuns: total,
      successRate,
      rejectionRate,
      hardFailureRate,
      blockedByPolicy,
      errorCategories,
      thresholds,
      sampleReady,
      gatePass,
      generatedAt: new Date(now).toISOString()
    };
  }

  reset(): void {
    this.events.length = 0;
  }

  private prune(now: number): void {
    const ttlMs = this.config.r1GateWindowMinutes * 60 * 1000;
    const threshold = now - ttlMs;
    while (this.events.length > 0 && this.events[0].at < threshold) {
      this.events.shift();
    }
  }

  private resolveErrorCategory(
    status: RunStatus,
    error?: string
  ): string | undefined {
    if (status === "rejected") {
      return "policy_rejection";
    }
    if (status !== "failed" || !error) {
      return undefined;
    }
    const normalized = error.toLowerCase();
    if (normalized.includes("timeout")) {
      return "timeout";
    }
    if (normalized.includes("tool_input_invalid")) {
      return "tool_input_invalid";
    }
    if (normalized.includes("network")) {
      return "network";
    }
    return "runtime_failure";
  }
}
