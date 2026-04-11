import { Injectable } from "@nestjs/common";
import type { ExecutionTraceStep } from "@text2sql/shared-types";
import type { SqlStreamEvent } from "../provider-router.service";

@Injectable()
export class ToolEventsMapper {
  toTraceStep(event: SqlStreamEvent): ExecutionTraceStep | undefined {
    if (event.type === "tool-call") {
      return {
        node: "tool-call",
        status: "success",
        detail: this.stringify(event.payload),
        at: new Date().toISOString(),
        outputSummary: this.stringify(event.payload)
      };
    }
    if (event.type === "tool-result") {
      return {
        node: "tool-result",
        status: "success",
        detail: this.stringify(event.payload),
        at: new Date().toISOString(),
        outputSummary: this.stringify(event.payload)
      };
    }
    if (event.type === "tool-error") {
      return {
        node: "tool-error",
        status: "failed",
        detail: this.stringify(event.payload),
        at: new Date().toISOString(),
        errorSummary: this.stringify(event.payload)
      };
    }
    return undefined;
  }

  private stringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
