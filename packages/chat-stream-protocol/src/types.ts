import type {
  ChatStreamEvent as SharedChatStreamEvent,
  ChatStreamEventData as SharedChatStreamEventData,
  ChatStreamEventType as SharedChatStreamEventType
} from "@text2sql/shared-types";

export type ChatStreamEvent = SharedChatStreamEvent;
export type ChatStreamEventData = SharedChatStreamEventData;
export type ChatStreamEventType = SharedChatStreamEventType;

export const CHAT_STREAM_PROTOCOL_ID = "text2sql.chat-stream";
export const CHAT_STREAM_PROTOCOL_VERSION = 1;

export const CHAT_STREAM_EVENT_TYPES = [
  "start",
  "text-delta",
  "tool-call",
  "tool-result",
  "tool-error",
  "state",
  "finish",
  "error"
] as const satisfies readonly ChatStreamEventType[];

export const TERMINAL_CHAT_STREAM_EVENT_TYPES = [
  "finish",
  "error"
] as const satisfies readonly ChatStreamEventType[];

export type ChatStreamTerminalEventType =
  (typeof TERMINAL_CHAT_STREAM_EVENT_TYPES)[number];

export type SseIgnoredReasonCode =
  | "empty_block"
  | "comment_only"
  | "missing_event"
  | "missing_data";

export type SseInvalidReasonCode =
  | "invalid_json"
  | "invalid_envelope"
  | "event_type_mismatch"
  | "incomplete_block";

export interface ParsedSseEventBlock {
  kind: "event";
  rawBlock: string;
  eventType: ChatStreamEventType;
  event: ChatStreamEvent;
  dataText: string;
}

export interface IgnoredSseEventBlock {
  kind: "ignored";
  rawBlock: string;
  reasonCode: SseIgnoredReasonCode;
}

export interface InvalidSseEventBlock {
  kind: "invalid";
  rawBlock: string;
  reasonCode: SseInvalidReasonCode;
  message: string;
  eventType?: string;
  dataText?: string;
}

export type SseBlockParseResult =
  | ParsedSseEventBlock
  | IgnoredSseEventBlock
  | InvalidSseEventBlock;

export interface SseChunkParseResult {
  results: SseBlockParseResult[];
  remainder: string;
}

export interface ChatStreamEnvelopeValidationResult {
  ok: boolean;
  reasonCode?: "invalid_envelope" | "event_type_mismatch";
  message?: string;
}
