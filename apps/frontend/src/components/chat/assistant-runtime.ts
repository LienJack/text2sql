"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { ChatMessage, ChatStreamEvent } from "@text2sql/shared-types";
import type { ChatModelAdapter, ThreadMessageLike } from "@assistant-ui/react";
import { useLocalRuntime } from "@assistant-ui/react";
import { streamMessageEvents } from "@/lib/api-client";

export interface AssistantRuntimeCallbacks {
  onStart?: () => void;
  onEvent?: (event: ChatStreamEvent) => void;
  onFinish?: (runId: string | undefined) => Promise<void> | void;
  onError?: (error: Error) => Promise<void> | void;
  onFinally?: () => void;
}

interface UseChatAssistantRuntimeInput {
  sessionId: string;
  messages: ChatMessage[];
  callbacks?: AssistantRuntimeCallbacks;
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

function createChatModelAdapter(
  sessionId: string,
  callbacksRef: MutableRefObject<AssistantRuntimeCallbacks | undefined>
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const userText = extractLatestUserText(messages);
      if (!sessionId || !userText) {
        return;
      }

      callbacksRef.current?.onStart?.();

      let aggregatedText = "";
      let runId: string | undefined;

      try {
        for await (const event of streamMessageEvents(
          sessionId,
          userText,
          abortSignal
        )) {
          runId = event.runId || runId;
          callbacksRef.current?.onEvent?.(event);

          if (event.type === "text-delta") {
            const delta = (event.data as { text?: string } | undefined)?.text ?? "";
            if (!delta) {
              continue;
            }
            aggregatedText += delta;
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
            const message =
              (event.data as { message?: string } | undefined)?.message ?? "流式响应失败";
            throw new Error(message);
          }
        }

        await callbacksRef.current?.onFinish?.(runId);
      } catch (runtimeError) {
        const normalizedError =
          runtimeError instanceof Error
            ? runtimeError
            : new Error("流式请求失败");
        await callbacksRef.current?.onError?.(normalizedError);
        throw normalizedError;
      } finally {
        callbacksRef.current?.onFinally?.();
      }
    }
  };
}

export function useChatAssistantRuntime({
  sessionId,
  messages,
  callbacks
}: UseChatAssistantRuntimeInput) {
  const callbacksRef = useRef<AssistantRuntimeCallbacks | undefined>(callbacks);

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const initialMessages = useMemo(() => mapToThreadMessages(messages), [messages]);

  const chatModel = useMemo(
    () => createChatModelAdapter(sessionId, callbacksRef),
    [sessionId]
  );

  return useLocalRuntime(chatModel, {
    initialMessages
  });
}
