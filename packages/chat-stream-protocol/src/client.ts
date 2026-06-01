import type {
  ChatStreamEnvelopeValidationResult,
  ChatStreamEvent,
  ChatStreamTerminalEventType,
  ChatStreamEventType,
  InvalidSseEventBlock,
  SseBlockParseResult,
  SseChunkParseResult
} from "./types";
import {
  CHAT_STREAM_EVENT_TYPES,
  TERMINAL_CHAT_STREAM_EVENT_TYPES
} from "./types";

const CHAT_STREAM_EVENT_TYPE_SET: ReadonlySet<string> = new Set(CHAT_STREAM_EVENT_TYPES);
const TERMINAL_CHAT_STREAM_EVENT_TYPE_SET: ReadonlySet<string> = new Set(
  TERMINAL_CHAT_STREAM_EVENT_TYPES
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isChatStreamEventType(value: unknown): value is ChatStreamEventType {
  return typeof value === "string" && CHAT_STREAM_EVENT_TYPE_SET.has(value);
}

export function isTerminalEventType(
  value: unknown
): value is ChatStreamTerminalEventType {
  return typeof value === "string" && TERMINAL_CHAT_STREAM_EVENT_TYPE_SET.has(value);
}

export function isTerminalEvent(
  eventOrType: ChatStreamEvent | ChatStreamEventType
): boolean {
  return isTerminalEventType(
    typeof eventOrType === "string" ? eventOrType : eventOrType.type
  );
}

export function validateChatStreamEnvelope(
  event: unknown,
  expectedEventType?: string
): ChatStreamEnvelopeValidationResult {
  if (!isRecord(event)) {
    return {
      ok: false,
      reasonCode: "invalid_envelope",
      message: "SSE payload is not an object."
    };
  }

  if (!isChatStreamEventType(event.type)) {
    return {
      ok: false,
      reasonCode: "invalid_envelope",
      message: "SSE payload `type` is missing or unsupported."
    };
  }

  if (typeof event.runId !== "string" || event.runId.length === 0) {
    return {
      ok: false,
      reasonCode: "invalid_envelope",
      message: "SSE payload `runId` must be a non-empty string."
    };
  }

  if (typeof event.sessionId !== "string" || event.sessionId.length === 0) {
    return {
      ok: false,
      reasonCode: "invalid_envelope",
      message: "SSE payload `sessionId` must be a non-empty string."
    };
  }

  if (typeof event.at !== "string" || event.at.length === 0) {
    return {
      ok: false,
      reasonCode: "invalid_envelope",
      message: "SSE payload `at` must be a non-empty string."
    };
  }

  if (!("data" in event)) {
    return {
      ok: false,
      reasonCode: "invalid_envelope",
      message: "SSE payload `data` field is required."
    };
  }

  if (expectedEventType && event.type !== expectedEventType) {
    return {
      ok: false,
      reasonCode: "event_type_mismatch",
      message: `SSE event name "${expectedEventType}" does not match payload type "${event.type}".`
    };
  }

  return { ok: true };
}

export function assertValidChatStreamEnvelope(
  event: unknown,
  expectedEventType?: string
): asserts event is ChatStreamEvent {
  const validation = validateChatStreamEnvelope(event, expectedEventType);
  if (!validation.ok) {
    throw new Error(validation.message ?? "Invalid chat stream envelope.");
  }
}

export function parseSseBlock(block: string): SseBlockParseResult {
  const trimmedBlock = block.trim();
  if (!trimmedBlock) {
    return {
      kind: "ignored",
      rawBlock: block,
      reasonCode: "empty_block"
    };
  }

  const lines = block.split("\n");
  let eventType: string | undefined;
  const dataLines: string[] = [];
  let sawNonCommentContent = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }
    if (trimmedLine.startsWith(":")) {
      continue;
    }
    sawNonCommentContent = true;
    if (trimmedLine.startsWith("event:")) {
      eventType = trimmedLine.replace(/^event:\s*/, "").trim();
      continue;
    }
    if (trimmedLine.startsWith("data:")) {
      dataLines.push(trimmedLine.replace(/^data:\s*/, ""));
    }
  }

  if (!sawNonCommentContent) {
    return {
      kind: "ignored",
      rawBlock: block,
      reasonCode: "comment_only"
    };
  }

  if (!eventType) {
    return {
      kind: "ignored",
      rawBlock: block,
      reasonCode: "missing_event"
    };
  }

  if (dataLines.length === 0) {
    return {
      kind: "ignored",
      rawBlock: block,
      reasonCode: "missing_data"
    };
  }

  const dataText = dataLines.join("\n");
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataText);
  } catch (error) {
    return {
      kind: "invalid",
      rawBlock: block,
      reasonCode: "invalid_json",
      message:
        error instanceof Error ? error.message : "Failed to parse SSE event JSON payload.",
      eventType,
      dataText
    };
  }

  const validation = validateChatStreamEnvelope(parsed, eventType);
  if (!validation.ok) {
    return {
      kind: "invalid",
      rawBlock: block,
      reasonCode: validation.reasonCode ?? "invalid_envelope",
      message: validation.message ?? "Invalid SSE event payload.",
      eventType,
      dataText
    };
  }

  const event = parsed as ChatStreamEvent;
  return {
    kind: "event",
    rawBlock: block,
    eventType: event.type,
    event,
    dataText
  };
}

export function parseSseEvents(payload: string): SseBlockParseResult[] {
  return payload
    .split(/\n\n+/)
    .map((block) => parseSseBlock(block));
}

export function parseSseChunk(
  buffer: string,
  chunk: string
): SseChunkParseResult {
  const nextBuffer = `${buffer}${chunk}`;
  const blocks = nextBuffer.split("\n\n");
  const remainder = blocks.pop() ?? "";
  return {
    results: blocks.map((block) => parseSseBlock(block)),
    remainder
  };
}

export function finalizeSseBuffer(buffer: string): SseBlockParseResult[] {
  if (!buffer.trim()) {
    return [];
  }
  return [
    {
      kind: "invalid",
      rawBlock: buffer,
      reasonCode: "incomplete_block",
      message: "SSE stream ended with an incomplete block."
    } satisfies InvalidSseEventBlock
  ];
}

export function toInvalidSseBlockError(result: InvalidSseEventBlock): Error {
  const suffix = result.eventType ? ` (event: ${result.eventType})` : "";
  return new Error(`${result.reasonCode}: ${result.message}${suffix}`);
}

export interface ReadSseStreamOptions {
  stopOnErrorEvent?: boolean;
}

export async function* readSseStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  options: ReadSseStreamOptions = {}
): AsyncGenerator<ChatStreamEvent, void, void> {
  if (!stream) {
    throw new Error("SSE response body is not readable.");
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let readerDone = false;

  const yieldParsedResults = async function* (
    results: SseBlockParseResult[]
  ): AsyncGenerator<ChatStreamEvent, boolean, void> {
    for (const result of results) {
      if (result.kind === "ignored") {
        continue;
      }
      if (result.kind === "invalid") {
        throw toInvalidSseBlockError(result);
      }
      yield result.event;
      if (options.stopOnErrorEvent !== false && result.event.type === "error") {
        return true;
      }
    }
    return false;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        readerDone = true;
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buffer, chunk);
      buffer = parsed.remainder;
      const stopped = yield* yieldParsedResults(parsed.results);
      if (stopped) {
        readerDone = true;
        await reader.cancel();
        return;
      }
    }

    const trailingText = decoder.decode();
    if (trailingText) {
      const parsed = parseSseChunk(buffer, trailingText);
      buffer = parsed.remainder;
      const stopped = yield* yieldParsedResults(parsed.results);
      if (stopped) {
        readerDone = true;
        await reader.cancel();
        return;
      }
    }

    yield* yieldParsedResults(finalizeSseBuffer(buffer));
  } finally {
    if (!readerDone) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

export interface CollectTextDeltaOptions {
  readableSectionBreak?: boolean;
}

function appendReadableDelta(current: string, delta: string): string {
  const trimmedStart = delta.trimStart();
  const looksLikeNextModelSection =
    /^<\s*\|/.test(trimmedStart) ||
    /^<\|/.test(trimmedStart) ||
    (/^<\s/.test(trimmedStart) && /\b(tool_calls?|function|DSML)\b/i.test(trimmedStart));

  if (!current || current.endsWith("\n") || !looksLikeNextModelSection) {
    return current + delta;
  }
  return `${current}\n\n${delta}`;
}

export function collectTextDelta(
  currentText: string,
  event: ChatStreamEvent,
  options: CollectTextDeltaOptions = {}
): string {
  if (event.type !== "text-delta") {
    return currentText;
  }
  const delta = (event.data as { text?: unknown } | undefined)?.text;
  if (typeof delta !== "string" || delta.length === 0) {
    return currentText;
  }
  return options.readableSectionBreak
    ? appendReadableDelta(currentText, delta)
    : currentText + delta;
}
