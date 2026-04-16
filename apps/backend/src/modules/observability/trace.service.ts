import { Injectable } from "@nestjs/common";
import type { ExecutionTrace, RunStatus } from "@text2sql/shared-types";
import { GateMetricsService } from "./gate-metrics.service";

interface TraceRecordMeta {
  status?: RunStatus;
  error?: string;
}

@Injectable()
export class TraceService {
  private readonly traces = new Map<string, ExecutionTrace>();

  constructor(private readonly gateMetrics: GateMetricsService) {}

  record(trace: ExecutionTrace, meta?: TraceRecordMeta): void {
    this.traces.set(trace.runId, trace);
    if (meta?.status) {
      this.gateMetrics.recordOutcome({
        status: meta.status,
        error: meta.error
      });
    }
  }

  get(runId: string): ExecutionTrace | undefined {
    return this.traces.get(runId);
  }
}
