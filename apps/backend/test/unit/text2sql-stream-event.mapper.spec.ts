import { Text2SqlStreamEventMapper } from "../../src/modules/conversation/text2sql/stream/text2sql-stream-event.mapper";

describe("Text2SqlStreamEventMapper", () => {
  const mapper = new Text2SqlStreamEventMapper();

  it("maps unknown step nodes safely with fallback stage/title", () => {
    const mapped = mapper.mapStepEvent({
      step: {
        node: "future-node",
        status: "success",
        at: "2026-04-26T00:00:00.000Z"
      },
      runId: "run-1",
      lastSequence: 0
    });

    expect(mapped.data).toMatchObject({
      node: "future-node",
      stage: "unknown",
      title: "future-node",
      sequence: 1
    });
  });

  it("maps tool-call/result/error events with trace payload", () => {
    const called = mapper.mapLlmEvent({
      type: "tool-call",
      toolName: "runReadOnlySql",
      toolCallId: "call-1",
      input: { sql: "SELECT 1" }
    });
    expect(called.type).toBe("tool-call");
    expect(called.traceToolCall?.status).toBe("called");

    const result = mapper.mapLlmEvent({
      type: "tool-result",
      toolName: "runReadOnlySql",
      toolCallId: "call-1",
      output: { rows: [] }
    });
    expect(result.type).toBe("tool-result");
    expect(result.traceToolCall?.status).toBe("result");

    const error = mapper.mapLlmEvent({
      type: "tool-error",
      toolName: "runReadOnlySql",
      toolCallId: "call-1",
      message: "failed"
    });
    expect(error.type).toBe("tool-error");
    expect(error.traceToolCall?.status).toBe("error");
  });

  it("builds stream envelope with required fields", () => {
    const envelope = mapper.createEnvelope({
      type: "start",
      data: {
        requestId: "req-1"
      },
      runId: "run-1",
      sessionId: "session-1",
      at: "2026-04-26T00:00:00.000Z"
    });

    expect(envelope).toEqual({
      type: "start",
      runId: "run-1",
      sessionId: "session-1",
      at: "2026-04-26T00:00:00.000Z",
      data: {
        requestId: "req-1"
      }
    });
  });
});
