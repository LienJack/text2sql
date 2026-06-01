import type { ChatStreamEvent, ChatStreamEventData, ChatStreamEventType } from "./types";

export interface ChatStreamSseWritable {
  writableEnded?: boolean;
  write(chunk: string): unknown;
  end?(): unknown;
}

export function createEventEnvelope(input: {
  type: ChatStreamEventType;
  runId: string;
  sessionId: string;
  data: ChatStreamEventData;
  at?: string;
}): ChatStreamEvent {
  return {
    type: input.type,
    runId: input.runId,
    sessionId: input.sessionId,
    at: input.at ?? new Date().toISOString(),
    data: input.data
  };
}

export const createChatStreamEventEnvelope = createEventEnvelope;

export function serializeSseEvent(
  event: ChatStreamEvent,
  eventType: ChatStreamEventType = event.type
): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function writeSseEvent(
  writer: ChatStreamSseWritable,
  event: ChatStreamEvent
): boolean {
  if (writer.writableEnded) {
    return false;
  }
  writer.write(serializeSseEvent(event));
  return true;
}

export function writeDone(
  writer: ChatStreamSseWritable,
  input: {
    runId: string;
    sessionId: string;
    data?: Extract<ChatStreamEventData, { status: unknown; rowCount: number }>;
    at?: string;
  }
): ChatStreamEvent {
  const event = createEventEnvelope({
    type: "finish",
    runId: input.runId,
    sessionId: input.sessionId,
    at: input.at,
    data: input.data ?? {
      status: "executionResult",
      rowCount: 0
    }
  });
  writeSseEvent(writer, event);
  return event;
}

export function writeErrorEvent(
  writer: ChatStreamSseWritable,
  input: {
    runId: string;
    sessionId: string;
    code?: string;
    message: string;
    details?: Record<string, unknown> | null;
    at?: string;
  }
): ChatStreamEvent {
  const event = createEventEnvelope({
    type: "error",
    runId: input.runId,
    sessionId: input.sessionId,
    at: input.at,
    data: {
      code: input.code,
      message: input.message,
      details: input.details ?? null
    }
  });
  writeSseEvent(writer, event);
  return event;
}
