import type { AnalysisEvent } from "@text2sql/shared-types";
import { describe, expect, it } from "vitest";
import { mergeAnalysisTaskEvents } from "@/lib/analysis-api-client";

function lifecycleEvent(sequence: number, type: string): AnalysisEvent {
  return {
    protocol: "analysis-task-protocol",
    version: "1.0.0",
    id: `event-${sequence}`,
    taskId: "task-lifecycle",
    revisionId: "revision-1",
    attemptId: "attempt-1",
    sequence,
    idempotencyKey: `key-${sequence}`,
    type,
    visibility: "user",
    at: `2026-07-17T00:00:0${sequence}.000Z`,
    data: {}
  };
}

describe("analysis task lifecycle projection", () => {
  it("reconnects from history without duplicating the start event and preserves terminal order", () => {
    const beforeDisconnect = [
      lifecycleEvent(1, "task.created"),
      lifecycleEvent(2, "orchestrator.started")
    ];
    const afterReconnect = [
      lifecycleEvent(2, "orchestrator.started"),
      lifecycleEvent(3, "artifact.committed"),
      lifecycleEvent(4, "manifest.sealed")
    ];
    const projected = mergeAnalysisTaskEvents(beforeDisconnect, afterReconnect);
    expect(projected.map((event) => event.type)).toEqual([
      "task.created",
      "orchestrator.started",
      "artifact.committed",
      "manifest.sealed"
    ]);
  });
});
