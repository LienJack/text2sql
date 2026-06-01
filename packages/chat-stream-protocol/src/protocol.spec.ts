import type { ChatStreamEvent } from "@text2sql/shared-types";
import {
  collectInvalidSseBlocks,
  collectTextDelta,
  createChatStreamEventEnvelope,
  createChatStreamEventFixture,
  finalizeSseBuffer,
  isTerminalEvent,
  parseSseBlock,
  parseSseChunk,
  parseSseEventsForTest,
  projectStreamEvent,
  readSseStream,
  serializeSseEvent,
  writeDone,
  writeErrorEvent,
  writeSseEvent
} from "./index";

describe("chat-stream-protocol", () => {
  it("round-trips a serialized start event through the SSE parser", () => {
    const event = createChatStreamEventEnvelope({
      type: "start",
      runId: "run-1",
      sessionId: "session-1",
      at: "2026-04-30T00:00:00.000Z",
      data: {
        requestId: "req-1"
      }
    });

    const parsed = parseSseBlock(serializeSseEvent(event));
    expect(parsed.kind).toBe("event");
    if (parsed.kind !== "event") {
      return;
    }

    expect(parsed.eventType).toBe("start");
    expect(parsed.event).toEqual(event);
  });

  it("keeps event ordering across multiple serialized blocks", () => {
    const blocks = [
      createChatStreamEventFixture({
        type: "start",
        runId: "run-2",
        sessionId: "session-2"
      }),
      createChatStreamEventFixture({
        type: "text-delta",
        runId: "run-2",
        sessionId: "session-2",
        data: {
          text: "SELECT payment_method"
        }
      }),
      createChatStreamEventFixture({
        type: "finish",
        runId: "run-2",
        sessionId: "session-2",
        data: {
          status: "executionResult",
          rowCount: 1
        }
      })
    ]
      .map((event) => serializeSseEvent(event))
      .join("");

    const chunkResult = parseSseChunk("", blocks);
    expect(chunkResult.remainder).toBe("");
    expect(parseSseEventsForTest(blocks).map((item) => item.event.type)).toEqual([
      "start",
      "text-delta",
      "finish"
    ]);
  });

  it("ignores empty and comment-only blocks with stable reasons", () => {
    expect(parseSseBlock("   ")).toMatchObject({
      kind: "ignored",
      reasonCode: "empty_block"
    });
    expect(parseSseBlock(": keep-alive\n\n")).toMatchObject({
      kind: "ignored",
      reasonCode: "comment_only"
    });
  });

  it("buffers partial chunks until a full delimiter arrives", () => {
    const event = createChatStreamEventFixture({
      type: "text-delta",
      runId: "run-3",
      sessionId: "session-3",
      data: {
        text: "partial"
      }
    });
    const serialized = serializeSseEvent(event);
    const midpoint = Math.floor(serialized.length / 2);

    const firstPass = parseSseChunk("", serialized.slice(0, midpoint));
    expect(firstPass.results).toHaveLength(0);
    expect(firstPass.remainder.length).toBeGreaterThan(0);

    const secondPass = parseSseChunk(firstPass.remainder, serialized.slice(midpoint));
    expect(secondPass.remainder).toBe("");
    expect(secondPass.results).toHaveLength(1);
    expect(secondPass.results[0]).toMatchObject({
      kind: "event"
    });
  });

  it("joins multi-line data payloads before JSON parsing", () => {
    const multiLineBlock = [
      "event: text-delta",
      'data: {"type":"text-delta","runId":"run-4","sessionId":"session-4",',
      'data: "at":"2026-04-30T00:00:00.000Z","data":{"text":"line1\\nline2"}}',
      "",
      ""
    ].join("\n");

    const parsed = parseSseBlock(multiLineBlock);
    expect(parsed.kind).toBe("event");
    if (parsed.kind !== "event") {
      return;
    }
    expect(parsed.event.data).toEqual({
      text: "line1\nline2"
    });
  });

  it("returns a stable invalid result for malformed JSON", () => {
    expect(collectInvalidSseBlocks('event: start\ndata: {"type":"start"\n\n')).toMatchObject(
      [
        {
          kind: "invalid",
          reasonCode: "invalid_json"
        }
      ]
    );
  });

  it("detects event-name and payload-type mismatches", () => {
    const mismatchBlock = [
      "event: finish",
      'data: {"type":"error","runId":"run-5","sessionId":"session-5","at":"2026-04-30T00:00:00.000Z","data":{"message":"boom"}}',
      "",
      ""
    ].join("\n");

    const parsed = parseSseBlock(mismatchBlock);
    expect(parsed).toMatchObject({
      kind: "invalid",
      reasonCode: "event_type_mismatch"
    });
  });

  it("marks finish and error as terminal events only", () => {
    expect(isTerminalEvent("finish")).toBe(true);
    expect(isTerminalEvent("error")).toBe(true);
    expect(isTerminalEvent("start")).toBe(false);
    expect(
      isTerminalEvent(
        createChatStreamEventFixture({
          type: "tool-call"
        })
      )
    ).toBe(false);
  });

  it("returns a stable invalid result for trailing incomplete buffers", () => {
    expect(finalizeSseBuffer('event: start\ndata: {"type":"start"}')).toMatchObject([
      {
        kind: "invalid",
        reasonCode: "incomplete_block"
      }
    ]);
  });

  it("produces fixture values assignable to ChatStreamEvent", () => {
    const fixture: ChatStreamEvent = createChatStreamEventFixture({
      type: "state"
    });

    expect(fixture.type).toBe("state");
    expect(fixture.runId).toBe("run_test");
  });

  it("writes server-side SSE events, finish terminals, and error terminals", () => {
    const chunks: string[] = [];
    const writer = {
      write(chunk: string) {
        chunks.push(chunk);
      }
    };
    const start = createChatStreamEventFixture({
      type: "start",
      runId: "run-writer",
      sessionId: "session-writer"
    });

    expect(writeSseEvent(writer, start)).toBe(true);
    const finish = writeDone(writer, {
      runId: "run-writer",
      sessionId: "session-writer"
    });
    const error = writeErrorEvent(writer, {
      runId: "run-writer",
      sessionId: "session-writer",
      code: "INTERNAL_ERROR",
      message: "boom"
    });

    expect(finish.type).toBe("finish");
    expect(error.type).toBe("error");
    expect(parseSseEventsForTest(chunks.join("")).map((item) => item.eventType)).toEqual([
      "start",
      "finish",
      "error"
    ]);
  });

  it("reads events from a ReadableStream and stops after error terminals", async () => {
    const events = [
      createChatStreamEventFixture({
        type: "start",
        runId: "run-reader",
        sessionId: "session-reader"
      }),
      createChatStreamEventFixture({
        type: "error",
        runId: "run-reader",
        sessionId: "session-reader",
        data: {
          code: "INTERNAL_ERROR",
          message: "boom",
          details: null
        }
      }),
      createChatStreamEventFixture({
        type: "finish",
        runId: "run-reader",
        sessionId: "session-reader"
      })
    ];
    const payload = events.map((event) => serializeSseEvent(event)).join("");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      }
    });

    const received: ChatStreamEvent[] = [];
    for await (const event of readSseStream(stream)) {
      received.push(event);
    }

    expect(received.map((event) => event.type)).toEqual(["start", "error"]);
  });

  it("collects text deltas with optional readable section breaks", () => {
    const first = collectTextDelta(
      "",
      createChatStreamEventFixture({
        type: "text-delta",
        data: {
          text: "hello"
        }
      })
    );
    const second = collectTextDelta(
      first,
      createChatStreamEventFixture({
        type: "text-delta",
        data: {
          text: "< |tool_call| >"
        }
      }),
      { readableSectionBreak: true }
    );

    expect(first).toBe("hello");
    expect(second).toContain("\n\n");
  });

  it("projects protocol events into framework-light UI patches", () => {
    const finish = createChatStreamEventFixture({
      type: "finish",
      data: {
        status: "executionResult",
        rowCount: 1,
        delivery: {
          answer: {
            text: "done",
            status: "executionResult",
            provider: "mock"
          }
        }
      }
    });

    expect(projectStreamEvent(finish)).toMatchObject({
      terminal: true,
      visibilityStatus: "success",
      deliveryPatch: {
        answer: {
          text: "done"
        }
      }
    });
  });
});
