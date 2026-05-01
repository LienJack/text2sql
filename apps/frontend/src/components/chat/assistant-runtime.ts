"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type {
  ChatMessage,
  ChatStreamEvent,
  ContextEnvelope
} from "@text2sql/shared-types";
import type { ChatModelAdapter, ThreadMessageLike } from "@assistant-ui/react";
import { useLocalRuntime } from "@assistant-ui/react";
import { collectTextDelta } from "@text2sql/chat-stream-protocol";
import { streamMessageEvents } from "@/lib/api-client";

export interface AssistantRuntimeCallbacks {
  onStart?: () => void;
  onAbortController?: (controller: AbortController | null) => void;
  onEvent?: (event: ChatStreamEvent) => void;
  onFinish?: (runId: string | undefined) => Promise<void> | void;
  onCancelled?: (runId: string | undefined) => Promise<void> | void;
  onError?: (error: Error) => Promise<void> | void;
  onFinally?: () => void;
}

interface UseChatAssistantRuntimeInput {
  sessionId: string;
  messages: ChatMessage[];
  callbacks?: AssistantRuntimeCallbacks;
  resolveContextEnvelope?: () => ContextEnvelope | undefined;
}

function mapToThreadMessages(messages: ChatMessage[]): ThreadMessageLike[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: message.content,
    metadata: message.metadata
  } as ThreadMessageLike));
}

function extractLatestUserText(messages: readonly ThreadMessageLike[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }
    if (typeof message.content === "string") {
      return message.content.trim();
    }
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function composeAbortSignal(
  signal: AbortSignal | undefined,
  localSignal: AbortSignal
): AbortSignal {
  if (!signal) {
    return localSignal;
  }
  if (signal.aborted) {
    return signal;
  }

  const controller = new AbortController();
  const abortFrom = (source: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(source.reason);
    }
  };

  signal.addEventListener("abort", () => abortFrom(signal), { once: true });
  localSignal.addEventListener("abort", () => abortFrom(localSignal), { once: true });
  return controller.signal;
}

function createChatModelAdapter(
  sessionId: string,
  callbacksRef: MutableRefObject<AssistantRuntimeCallbacks | undefined>,
  resolveContextEnvelopeRef: MutableRefObject<
    (() => ContextEnvelope | undefined) | undefined
  >
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const userText = extractLatestUserText(messages);
      if (!sessionId || !userText) {
        return;
      }
      const contextEnvelope = resolveContextEnvelopeRef.current?.();

      callbacksRef.current?.onStart?.();
      const localAbortController = new AbortController();
      callbacksRef.current?.onAbortController?.(localAbortController);
      const effectiveAbortSignal = composeAbortSignal(
        abortSignal,
        localAbortController.signal
      );

      let aggregatedText = "";
      let runId: string | undefined;
      let streamError: Error | null = null;
      let cancelledByUser = false;

      try {
        for await (const event of streamMessageEvents(
          sessionId,
          userText,
          effectiveAbortSignal,
          contextEnvelope
        )) {
          runId = event.runId || runId;
          callbacksRef.current?.onEvent?.(event);

          if (event.type === "text-delta") {
            const nextText = collectTextDelta(aggregatedText, event, {
              readableSectionBreak: true
            });
            if (nextText === aggregatedText) {
              continue;
            }
            aggregatedText = nextText;
            yield {
              content: [
                {
                  type: "text",
                  text: aggregatedText
                }
              ],
              metadata: {
                custom: {
                  runId
                }
              }
            };
            continue;
          }

          if (event.type === "error") {
            const payload = event.data as
              | { code?: string; message?: string }
              | undefined;
            if (payload?.code === "USER_CANCELLED") {
              cancelledByUser = true;
              break;
            }
            const message = payload?.message ?? "流式响应失败";
            streamError = new Error(message);
            break;
          }
        }

        if (cancelledByUser || effectiveAbortSignal.aborted) {
          await callbacksRef.current?.onCancelled?.(runId);
          return;
        }

        if (streamError) {
          await callbacksRef.current?.onError?.(streamError);
          return;
        }

        await callbacksRef.current?.onFinish?.(runId);
      } catch (runtimeError) {
        if (effectiveAbortSignal.aborted) {
          await callbacksRef.current?.onCancelled?.(runId);
          return;
        }
        const normalizedError =
          runtimeError instanceof Error
            ? runtimeError
            : new Error("流式请求失败");
        await callbacksRef.current?.onError?.(normalizedError);
        return;
      } finally {
        callbacksRef.current?.onAbortController?.(null);
        callbacksRef.current?.onFinally?.();
      }
    }
  };
}

export function useChatAssistantRuntime({
  sessionId,
  messages,
  callbacks,
  resolveContextEnvelope
}: UseChatAssistantRuntimeInput) {
  const callbacksRef = useRef<AssistantRuntimeCallbacks | undefined>(callbacks);
  const resolveContextEnvelopeRef = useRef<
    (() => ContextEnvelope | undefined) | undefined
  >(resolveContextEnvelope);

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);
  useEffect(() => {
    resolveContextEnvelopeRef.current = resolveContextEnvelope;
  }, [resolveContextEnvelope]);

  const initialMessages = useMemo(() => mapToThreadMessages(messages), [messages]);

  const chatModel = useMemo(
    () =>
      createChatModelAdapter(
        sessionId,
        callbacksRef,
        resolveContextEnvelopeRef
      ),
    [sessionId]
  );

  return useLocalRuntime(chatModel, {
    initialMessages
  });
}
