"use client";

import { useMemo, useState } from "react";
import type {
  ChatMessage,
  ChatStreamEvent,
  DeliveryContract,
  SqlRun
} from "@text2sql/shared-types";
import {
  AssistantRuntimeProvider,
  AuiIf,
  ThreadPrimitive
} from "@assistant-ui/react";
import { ArrowDown, Loader2 } from "lucide-react";
import { AssistantComposer } from "@/components/chat/assistant-composer";
import {
  buildContextEnvelopeFromDraft,
  createEmptyContextEnvelopeDraft
} from "@/components/chat/context-envelope-panel";
import {
  AssistantThinkingPanel,
  type ThinkingStreamStep
} from "@/components/chat/assistant-thinking-panel";
import {
  AssistantMessageBubble,
  UserMessageBubble
} from "@/components/chat/assistant-message";
import {
  mergeRunThinkingSteps,
  resolveRunVisibilityStatus,
  resolveVisibleDelivery,
  type RunVisibilityStatus
} from "@/components/chat/run-visibility-mapper";
import {
  AssistantRuntimeCallbacks,
  useChatAssistantRuntime
} from "@/components/chat/assistant-runtime";

interface AssistantThreadProps {
  sessionId: string;
  messages: ChatMessage[];
  runsById: Record<string, SqlRun>;
  streamThinkingByRunId: Record<string, ThinkingStreamStep[]>;
  runLoadingById: Record<string, boolean>;
  streamDeliveryByRunId: Record<string, DeliveryContract>;
  streamTextStartedByRunId: Record<string, boolean>;
  runVisibilityByRunId: Record<string, RunVisibilityStatus>;
  activeStreamRunId: string | null;
  thinkingRequestPending: boolean;
  debugEnabled: boolean;
  disabled?: boolean;
  onRequestRun?: (runId: string) => Promise<void> | void;
  onRunStart?: () => void;
  onRunFinish?: (runId: string | undefined) => Promise<void> | void;
  onRunError?: (error: Error) => Promise<void> | void;
  onStreamEvent?: (event: ChatStreamEvent) => void;
}

function resolveMessageRunId(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }
  const record = metadata as Record<string, unknown>;
  if (typeof record.runId === "string" && record.runId) {
    return record.runId;
  }
  if (
    record.custom &&
    typeof record.custom === "object" &&
    typeof (record.custom as Record<string, unknown>).runId === "string"
  ) {
    return (record.custom as Record<string, unknown>).runId as string;
  }
  return undefined;
}

export function AssistantThread({
  sessionId,
  messages,
  runsById,
  streamThinkingByRunId,
  runLoadingById,
  streamDeliveryByRunId,
  streamTextStartedByRunId,
  runVisibilityByRunId,
  activeStreamRunId,
  thinkingRequestPending,
  debugEnabled,
  disabled = false,
  onRequestRun,
  onRunStart,
  onRunFinish,
  onRunError,
  onStreamEvent
}: AssistantThreadProps) {
  const [sqlOpenSignal, setSqlOpenSignal] = useState(0);
  const [contextEnvelopeDraft, setContextEnvelopeDraft] = useState(
    createEmptyContextEnvelopeDraft
  );
  const [clearContextEnvelopeAfterSend, setClearContextEnvelopeAfterSend] =
    useState(true);

  const latestAssistantMessageId = useMemo(() => {
    return [...messages].reverse().find((message) => message.role === "assistant")?.id;
  }, [messages]);
  const runIdByMessageId = useMemo(() => {
    const mapping: Record<string, string> = {};
    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }
      const runId = resolveMessageRunId(message.metadata);
      if (runId) {
        mapping[message.id] = runId;
      }
    }
    return mapping;
  }, [messages]);
  const assistantContentByMessageId = useMemo(() => {
    const mapping: Record<string, string> = {};
    for (const message of messages) {
      if (message.role === "assistant" && typeof message.content === "string") {
        mapping[message.id] = message.content;
      }
    }
    return mapping;
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

  const resolveContextEnvelopeForSend = useMemo(
    () => () => {
      const envelope = buildContextEnvelopeFromDraft(contextEnvelopeDraft);
      if (clearContextEnvelopeAfterSend) {
        setContextEnvelopeDraft(createEmptyContextEnvelopeDraft());
      }
      return envelope;
    },
    [
      clearContextEnvelopeAfterSend,
      contextEnvelopeDraft
    ]
  );

  const runtime = useChatAssistantRuntime({
    sessionId,
    messages,
    callbacks,
    resolveContextEnvelope: resolveContextEnvelopeForSend
  });
  const activeStreamSteps = activeStreamRunId
    ? streamThinkingByRunId[activeStreamRunId] ?? []
    : [];
  const activeStreamTextStarted = activeStreamRunId
    ? Boolean(streamTextStartedByRunId[activeStreamRunId])
    : false;
  const showStandaloneThinking =
    Boolean(activeStreamRunId) &&
    activeStreamSteps.length > 0 &&
    !activeStreamTextStarted;

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
                  const resolvedRunId =
                    runIdByMessageId[message.id] ??
                    (isLatestAssistant ? activeStreamRunId ?? undefined : undefined);
                  const run = resolvedRunId ? runsById[resolvedRunId] ?? null : null;
                  const streamSteps = resolvedRunId
                    ? streamThinkingByRunId[resolvedRunId] ?? []
                    : [];
                  const thinkingSteps = mergeRunThinkingSteps(
                    run?.trace.steps,
                    streamSteps
                  );
                  const runVisibilityStatus = resolvedRunId
                    ? resolveRunVisibilityStatus({
                        runStatus: run?.status,
                        streamStatus: runVisibilityByRunId[resolvedRunId],
                        activeStream: activeStreamRunId === resolvedRunId
                      })
                    : undefined;
                  const thinkingInProgress = runVisibilityStatus === "loading";
                  const streamDelivery = resolvedRunId
                    ? resolveVisibleDelivery({
                        runDelivery: run?.delivery,
                        streamDelivery: streamDeliveryByRunId[resolvedRunId],
                        answerText: assistantContentByMessageId[message.id],
                        runStatus: run?.status,
                        runProvider: run?.provider,
                        runModel: run?.model
                      })
                    : undefined;
                  return (
                    <AssistantMessageBubble
                      run={run}
                      streamDelivery={streamDelivery}
                      runId={resolvedRunId}
                      debugEnabled={debugEnabled}
                      thinkingSteps={thinkingSteps}
                      thinkingInProgress={thinkingInProgress}
                      runLoading={Boolean(
                        resolvedRunId && runLoadingById[resolvedRunId]
                      )}
                      onRequestRun={
                        resolvedRunId && !run && !thinkingInProgress
                          ? () => onRequestRun?.(resolvedRunId)
                          : undefined
                      }
                      openSqlSignal={isLatestAssistant ? sqlOpenSignal : 0}
                      highlightSql={isLatestAssistant}
                    />
                  );
                }
                return null;
              }}
            </ThreadPrimitive.Messages>
            {showStandaloneThinking && activeStreamRunId ? (
              <div
                className="mt-3 rounded-2xl border border-[var(--chat-result-shell-border)] bg-[var(--chat-result-shell-bg)] p-2.5 shadow-[var(--chat-result-shell-shadow)]"
                data-testid="assistant-live-thinking"
                data-run-id={activeStreamRunId}
              >
                <AssistantThinkingPanel
                  run={null}
                  streamSteps={activeStreamSteps}
                  inProgress
                  hasRunReference
                />
              </div>
            ) : null}
            {thinkingRequestPending && !activeStreamRunId ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                <Loader2 className="h-3 w-3 animate-spin text-[var(--action-primary)]" />
                思考中...
              </div>
            ) : null}
          </div>

          <ThreadPrimitive.ViewportFooter className="sticky bottom-0 bg-gradient-to-t from-[var(--surface-page)] to-transparent pt-4">
            <AssistantComposer
              disabled={disabled}
              onOpenDetail={() => {
                setSqlOpenSignal((previous) => previous + 1);
              }}
              contextEnvelopeDraft={contextEnvelopeDraft}
              clearContextEnvelopeAfterSend={clearContextEnvelopeAfterSend}
              onContextEnvelopeDraftChange={setContextEnvelopeDraft}
              onClearContextEnvelopeAfterSendChange={
                setClearContextEnvelopeAfterSend
              }
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
