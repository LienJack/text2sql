import {
  ANALYSIS_TASK_PROTOCOL_ID,
  ANALYSIS_TASK_PROTOCOL_VERSION,
  assertAnalysisEvent,
  isAnalysisTaskTerminalStatus,
  mergeAnalysisEvents,
  serializeAnalysisEventSse,
  transitionAnalysisTaskStatus
} from "./index";

describe("analysis task protocol", () => {
  it("validates a canonical event envelope", () => {
    expect(
      assertAnalysisEvent({
        protocol: ANALYSIS_TASK_PROTOCOL_ID,
        version: ANALYSIS_TASK_PROTOCOL_VERSION,
        id: "event-1",
        taskId: "task-1",
        sequence: 1,
        idempotencyKey: "event:create",
        type: "task.created",
        visibility: "user",
        at: "2026-07-17T00:00:00.000Z",
        data: { status: "draft" }
      })
    ).toMatchObject({ taskId: "task-1", sequence: 1 });
  });

  it("rejects invalid and zero-sequence events", () => {
    expect(() =>
      assertAnalysisEvent({
        protocol: ANALYSIS_TASK_PROTOCOL_ID,
        version: ANALYSIS_TASK_PROTOCOL_VERSION,
        id: "event-1",
        taskId: "task-1",
        sequence: 0,
        idempotencyKey: "event:create",
        type: "task.created",
        at: "invalid",
        data: {}
      })
    ).toThrow("invalid analysis event envelope");
  });

  it("keeps terminal status semantics explicit", () => {
    expect(isAnalysisTaskTerminalStatus("completed")).toBe(true);
    expect(isAnalysisTaskTerminalStatus("partial")).toBe(true);
    expect(isAnalysisTaskTerminalStatus("running")).toBe(false);
    expect(transitionAnalysisTaskStatus("cancelled", "running")).toBe("cancelled");
  });

  it("deduplicates reconnect events by sequence and serializes cursor ids", () => {
    const event = assertAnalysisEvent({
      protocol: ANALYSIS_TASK_PROTOCOL_ID,
      version: ANALYSIS_TASK_PROTOCOL_VERSION,
      id: "event-2",
      taskId: "task-1",
      sequence: 2,
      idempotencyKey: "event:2",
      type: "task.running",
      visibility: "user",
      at: "2026-07-17T00:00:01.000Z",
      data: { status: "running" }
    });
    expect(mergeAnalysisEvents([event], [event])).toEqual([event]);
    expect(serializeAnalysisEventSse(event)).toContain("id: 2");
  });
});
