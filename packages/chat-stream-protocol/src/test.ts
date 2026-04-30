import { assertValidChatStreamEnvelope, parseSseEvents } from "./client";
import type {
  ChatStreamEvent,
  ChatStreamEventData,
  ChatStreamEventType,
  InvalidSseEventBlock
} from "./types";
import { createChatStreamEventEnvelope } from "./server";

export interface ParsedTestSseEvent {
  eventType: ChatStreamEventType;
  event: ChatStreamEvent;
}

function buildDefaultData(type: ChatStreamEventType): ChatStreamEventData {
  switch (type) {
    case "start":
      return { requestId: "req_test" };
    case "text-delta":
      return { text: "SELECT 1" };
    case "tool-call":
      return {
        toolName: "query",
        toolCallId: "tool-call-1",
        input: { sql: "SELECT 1" },
        title: "调用 query",
        stage: "generation",
        summary: "执行查询"
      };
    case "tool-result":
      return {
        toolName: "query",
        toolCallId: "tool-call-1",
        output: { rowCount: 1 },
        title: "工具返回：query",
        stage: "generation",
        summary: "返回 1 行"
      };
    case "tool-error":
      return {
        toolName: "query",
        toolCallId: "tool-call-1",
        message: "工具失败",
        title: "工具失败：query",
        stage: "generation",
        summary: "工具失败"
      };
    case "state":
      return {
        node: "generate-sql",
        status: "success",
        detail: "生成 SQL",
        sequence: 1,
        lifecycle: "completed",
        title: "生成 SQL",
        stage: "generation"
      };
    case "finish":
      return {
        status: "executionResult",
        rowCount: 1
      };
    case "error":
      return {
        code: "INTERNAL_ERROR",
        message: "流式响应失败",
        details: null
      };
  }
}

export function createChatStreamEventFixture(input?: {
  type?: ChatStreamEventType;
  runId?: string;
  sessionId?: string;
  at?: string;
  data?: ChatStreamEventData;
}): ChatStreamEvent {
  const type = input?.type ?? "start";
  return createChatStreamEventEnvelope({
    type,
    runId: input?.runId ?? "run_test",
    sessionId: input?.sessionId ?? "session_test",
    at: input?.at ?? "2026-04-30T00:00:00.000Z",
    data: input?.data ?? buildDefaultData(type)
  });
}

export function collectInvalidSseBlocks(payload: string): InvalidSseEventBlock[] {
  return parseSseEvents(payload).filter(
    (result): result is InvalidSseEventBlock => result.kind === "invalid"
  );
}

export function parseSseEventsForTest(payload: string): ParsedTestSseEvent[] {
  return parseSseEvents(payload)
    .filter((result) => result.kind === "event")
    .map((result) => ({
      eventType: result.eventType,
      event: result.event
    }));
}

export function assertEventEnvelope(
  event: unknown,
  expectedEventType?: string
): asserts event is ChatStreamEvent {
  assertValidChatStreamEnvelope(event, expectedEventType);
}
