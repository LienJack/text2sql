"use client";

import { useMemo, useState } from "react";
import type {
  ChatMessage,
  ChatStreamEvent,
  SqlRun
} from "@text2sql/shared-types";
import {
  AssistantRuntimeProvider,
  AuiIf,
  ThreadPrimitive
} from "@assistant-ui/react";
import { ArrowDown } from "lucide-react";
import { AssistantComposer } from "@/components/chat/assistant-composer";
import {
  AssistantMessageBubble,
  UserMessageBubble
} from "@/components/chat/assistant-message";
import {
  AssistantRuntimeCallbacks,
  useChatAssistantRuntime
} from "@/components/chat/assistant-runtime";

interface AssistantThreadProps {
  sessionId: string;
  messages: ChatMessage[];
  run: SqlRun | null;
  debugEnabled: boolean;
  disabled?: boolean;
  onRunStart?: () => void;
  onRunFinish?: (runId: string | undefined) => Promise<void> | void;
  onRunError?: (error: Error) => Promise<void> | void;
  onStreamEvent?: (event: ChatStreamEvent) => void;
}

export function AssistantThread({
  sessionId,
  messages,
  run,
  debugEnabled,
  disabled = false,
  onRunStart,
  onRunFinish,
  onRunError,
  onStreamEvent
}: AssistantThreadProps) {
  const [sqlOpenSignal, setSqlOpenSignal] = useState(0);

  const latestAssistantMessageId = useMemo(() => {
    return [...messages].reverse().find((message) => message.role === "assistant")?.id;
  }, [messages]);

  const callbacks = useMemo<AssistantRuntimeCallbacks>(
    () => ({
      onStart: onRunStart,
      onEvent: onStreamEvent,
      onError: onRunError,
      onFinish: async (runId) => {
        await onRunFinish?.(runId);
      }
    }),
    [
      onRunError,
      onRunFinish,
      onRunStart,
      onStreamEvent
    ]
  );

  const runtime = useChatAssistantRuntime({
    sessionId,
    messages,
    callbacks
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
        <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-page)] px-4 py-6 sm:px-8">
          <div className="mx-auto w-full max-w-4xl">
            <AuiIf condition={(state) => state.thread.isEmpty}>
              <p className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-panel)] px-5 py-4 text-sm text-[var(--text-secondary)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                发送第一条消息开始演示。
              </p>
            </AuiIf>

            <ThreadPrimitive.Messages>
              {({ message }) => {
                if (message.role === "user") {
                  return <UserMessageBubble />;
                }
                if (message.role === "assistant") {
                  const isLatestAssistant = message.id === latestAssistantMessageId;
                  return (
                    <AssistantMessageBubble
                      run={isLatestAssistant ? run : null}
                      debugEnabled={debugEnabled}
                      openSqlSignal={isLatestAssistant ? sqlOpenSignal : 0}
                      highlightSql={isLatestAssistant}
                    />
                  );
                }
                return null;
              }}
            </ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 bg-gradient-to-t from-[var(--surface-page)] to-transparent pt-4">
            <AssistantComposer
              disabled={disabled}
              onOpenDetail={() => {
                setSqlOpenSignal((previous) => previous + 1);
              }}
            />
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>

        <ThreadPrimitive.ScrollToBottom asChild>
          <button
            type="button"
            aria-label="回到底部"
            className="absolute bottom-28 right-8 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-panel)] text-[var(--text-secondary)] shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
