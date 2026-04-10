import { Injectable } from "@nestjs/common";
import type { ExecutionTrace } from "@text2sql/shared-types";

@Injectable()
export class TraceService {
  private readonly traces = new Map<string, ExecutionTrace>();

  record(trace: ExecutionTrace): void {
    this.traces.set(trace.runId, trace);
  }

  get(runId: string): ExecutionTrace | undefined {
    return this.traces.get(runId);
  }
}

