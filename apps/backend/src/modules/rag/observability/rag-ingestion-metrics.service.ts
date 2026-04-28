import { Injectable } from "@nestjs/common";

export type RagIngestionBuildStatus = "success" | "failure";

interface RagIngestionBuildMetricEvent {
  at: number;
  datasourceId: string;
  status: RagIngestionBuildStatus;
  indexVersionId?: string;
  sourceVersion?: string;
  activationLatencyMs?: number;
  failureReason?: string;
}

export interface RagIngestionBuildMetricInput {
  datasourceId: string;
  status: RagIngestionBuildStatus;
  indexVersionId?: string;
  sourceVersion?: string;
  activationLatencyMs?: number;
  failureReason?: string;
  at?: string;
}

export interface RagIngestionActiveIndexSummaryItem {
  datasourceId: string;
  indexVersionId: string;
  sourceVersion?: string;
  activatedAt: string;
}

export interface RagIngestionMetricsSnapshot {
  windowMinutes: number;
  observedBuilds: number;
  buildSuccessCount: number;
  buildFailureCount: number;
  buildSuccessRate: number;
  buildFailureRate: number;
  failureReasons: Record<string, number>;
  activationLatencyMs: {
    count: number;
    avg: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
  };
  activeIndexSummary: {
    total: number;
    items: RagIngestionActiveIndexSummaryItem[];
  };
  degradedReason?: "no_active_index";
  generatedAt: string;
}

@Injectable()
export class RagIngestionMetricsService {
  private readonly events: RagIngestionBuildMetricEvent[] = [];
  private readonly activeIndexesByDatasource = new Map<
    string,
    RagIngestionActiveIndexSummaryItem
  >();
  private readonly windowMinutes = 60;

  recordBuild(input: RagIngestionBuildMetricInput): void {
    const at = this.resolveTimestamp(input.at);
    const normalizedLatency =
      typeof input.activationLatencyMs === "number" &&
      Number.isFinite(input.activationLatencyMs) &&
      input.activationLatencyMs >= 0
        ? input.activationLatencyMs
        : undefined;
    const normalizedFailureReason =
      input.status === "failure"
        ? (input.failureReason?.trim().toLowerCase() ?? "unknown")
        : undefined;

    this.events.push({
      at,
      datasourceId: input.datasourceId,
      status: input.status,
      indexVersionId: input.indexVersionId,
      sourceVersion: input.sourceVersion,
      activationLatencyMs: normalizedLatency,
      failureReason: normalizedFailureReason
    });
    this.prune(at);

    if (input.status === "success" && input.indexVersionId) {
      this.activeIndexesByDatasource.set(input.datasourceId, {
        datasourceId: input.datasourceId,
        indexVersionId: input.indexVersionId,
        sourceVersion: input.sourceVersion,
        activatedAt: new Date(at).toISOString()
      });
    }
  }

  snapshot(now = Date.now()): RagIngestionMetricsSnapshot {
    this.prune(now);
    const total = this.events.length;
    const buildSuccessCount = this.events.filter((event) => event.status === "success").length;
    const buildFailureCount = total - buildSuccessCount;
    const buildSuccessRate = total === 0 ? 0 : buildSuccessCount / total;
    const buildFailureRate = total === 0 ? 0 : buildFailureCount / total;

    const failureReasons: Record<string, number> = {};
    for (const event of this.events) {
      if (event.status !== "failure") {
        continue;
      }
      const reason = event.failureReason ?? "unknown";
      failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
    }

    const activationLatencies = this.events
      .filter((event) => event.status === "success")
      .map((event) => event.activationLatencyMs)
      .filter((value): value is number => typeof value === "number")
      .sort((left, right) => left - right);

    const latencyCount = activationLatencies.length;
    const latencySum = activationLatencies.reduce((sum, value) => sum + value, 0);
    const activeIndexItems = Array.from(this.activeIndexesByDatasource.values()).sort(
      (left, right) => Date.parse(right.activatedAt) - Date.parse(left.activatedAt)
    );

    return {
      windowMinutes: this.windowMinutes,
      observedBuilds: total,
      buildSuccessCount,
      buildFailureCount,
      buildSuccessRate,
      buildFailureRate,
      failureReasons,
      activationLatencyMs: {
        count: latencyCount,
        avg: latencyCount === 0 ? 0 : latencySum / latencyCount,
        min: latencyCount === 0 ? 0 : activationLatencies[0],
        max: latencyCount === 0 ? 0 : activationLatencies[latencyCount - 1],
        p50: this.percentile(activationLatencies, 0.5),
        p95: this.percentile(activationLatencies, 0.95)
      },
      activeIndexSummary: {
        total: activeIndexItems.length,
        items: activeIndexItems.map((item) => ({ ...item }))
      },
      degradedReason: activeIndexItems.length === 0 ? "no_active_index" : undefined,
      generatedAt: new Date(now).toISOString()
    };
  }

  reset(): void {
    this.events.length = 0;
    this.activeIndexesByDatasource.clear();
  }

  private prune(now: number): void {
    const ttlMs = this.windowMinutes * 60 * 1000;
    const threshold = now - ttlMs;
    while (this.events.length > 0 && this.events[0].at < threshold) {
      this.events.shift();
    }
  }

  private percentile(values: number[], ratio: number): number {
    if (values.length === 0) {
      return 0;
    }
    const index = Math.ceil(values.length * ratio) - 1;
    const boundedIndex = Math.min(values.length - 1, Math.max(0, index));
    return values[boundedIndex];
  }

  private resolveTimestamp(value?: string): number {
    if (!value) {
      return Date.now();
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return Date.now();
    }
    return parsed;
  }
}
