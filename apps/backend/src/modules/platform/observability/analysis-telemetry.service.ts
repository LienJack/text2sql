import { Injectable } from "@nestjs/common";

export const ANALYSIS_TELEMETRY_OPERATIONS = [
  "task.create",
  "task.command",
  "workflow.dispatch",
  "work.execute",
  "artifact.commit",
  "gate.evaluate"
] as const;

export type AnalysisTelemetryOperation =
  (typeof ANALYSIS_TELEMETRY_OPERATIONS)[number];

type Aggregate = {
  count: number;
  failed: number;
  durationMsTotal: number;
  durationMsMax: number;
  queueWaitMsTotal: number;
  retries: number;
  budgetUnits: number;
};

export type AnalysisTelemetrySpan = {
  operation: AnalysisTelemetryOperation;
  correlation: {
    taskId?: string;
    attemptId?: string;
    workItemId?: string;
    runId?: string;
  };
  startedAt: number;
  end(input?: {
    status?: "ok" | "error";
    reasonCode?: string;
    queueWaitMs?: number;
    retries?: number;
    budgetUnits?: number;
    coverageRatio?: number;
  }): void;
};

const emptyAggregate = (): Aggregate => ({
  count: 0,
  failed: 0,
  durationMsTotal: 0,
  durationMsMax: 0,
  queueWaitMsTotal: 0,
  retries: 0,
  budgetUnits: 0
});

@Injectable()
export class AnalysisTelemetryService {
  private readonly aggregates = new Map<AnalysisTelemetryOperation, Aggregate>();
  private redactedAttributeCount = 0;
  private invalidReasonCodeCount = 0;

  startSpan(input: {
    operation: AnalysisTelemetryOperation;
    taskId?: string;
    attemptId?: string;
    workItemId?: string;
    runId?: string;
  }): AnalysisTelemetrySpan {
    const startedAt = Date.now();
    let ended = false;
    return {
      operation: input.operation,
      correlation: {
        taskId: this.correlationId(input.taskId),
        attemptId: this.correlationId(input.attemptId),
        workItemId: this.correlationId(input.workItemId),
        runId: this.correlationId(input.runId)
      },
      startedAt,
      end: (result = {}) => {
        if (ended) return;
        ended = true;
        this.record({
          operation: input.operation,
          durationMs: Math.max(0, Date.now() - startedAt),
          status: result.status ?? "ok",
          reasonCode: result.reasonCode,
          queueWaitMs: result.queueWaitMs,
          retries: result.retries,
          budgetUnits: result.budgetUnits,
          coverageRatio: result.coverageRatio
        });
      }
    };
  }

  record(input: {
    operation: AnalysisTelemetryOperation;
    durationMs: number;
    status: "ok" | "error";
    reasonCode?: string;
    queueWaitMs?: number;
    retries?: number;
    budgetUnits?: number;
    coverageRatio?: number;
    attributes?: Record<string, unknown>;
  }): void {
    if (input.attributes) {
      this.redactedAttributeCount += Object.keys(input.attributes).length;
    }
    if (input.reasonCode && !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.reasonCode)) {
      this.invalidReasonCodeCount += 1;
    }
    const aggregate = this.aggregates.get(input.operation) ?? emptyAggregate();
    const durationMs = this.boundedNumber(input.durationMs, 86_400_000);
    aggregate.count += 1;
    aggregate.failed += input.status === "error" ? 1 : 0;
    aggregate.durationMsTotal += durationMs;
    aggregate.durationMsMax = Math.max(aggregate.durationMsMax, durationMs);
    aggregate.queueWaitMsTotal += this.boundedNumber(input.queueWaitMs, 86_400_000);
    aggregate.retries += this.boundedNumber(input.retries, 1_000);
    aggregate.budgetUnits += this.boundedNumber(input.budgetUnits, 1_000_000_000);
    this.aggregates.set(input.operation, aggregate);
  }

  snapshot() {
    return {
      version: "analysis-telemetry/v1" as const,
      privacy: {
        metricLabels: ["operation", "status"],
        correlationIdsInMetrics: false,
        forbiddenPayloads: [
          "prompt",
          "sql_rows",
          "web_body",
          "token",
          "url_secret",
          "personal_data"
        ],
        redactedAttributeCount: this.redactedAttributeCount,
        invalidReasonCodeCount: this.invalidReasonCodeCount
      },
      operations: Object.fromEntries(
        ANALYSIS_TELEMETRY_OPERATIONS.map((operation) => {
          const value = this.aggregates.get(operation) ?? emptyAggregate();
          return [
            operation,
            {
              count: value.count,
              failed: value.failed,
              durationMsAvg:
                value.count === 0
                  ? 0
                  : Number((value.durationMsTotal / value.count).toFixed(2)),
              durationMsMax: value.durationMsMax,
              queueWaitMsTotal: value.queueWaitMsTotal,
              retries: value.retries,
              budgetUnits: value.budgetUnits
            }
          ];
        })
      )
    };
  }

  private correlationId(value?: string): string | undefined {
    if (!value) return undefined;
    const normalized = value.trim();
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(normalized)) {
      this.redactedAttributeCount += 1;
      return "redacted";
    }
    return normalized;
  }

  private boundedNumber(value: number | undefined, max: number): number {
    if (!Number.isFinite(value) || (value ?? 0) < 0) return 0;
    return Math.min(max, Math.round(value ?? 0));
  }
}
