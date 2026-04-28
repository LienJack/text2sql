"use client";

import { useState } from "react";
import type {
  DeliveryContract,
  ExecutionTraceStep,
  ReasoningStage,
  SqlRun
} from "@text2sql/shared-types";
import { MessagePartPrimitive, MessagePrimitive } from "@assistant-ui/react";
import { Database } from "lucide-react";
import { ChatBIResultPanel } from "@/components/chat/chatbi-result-panel";
import { AssistantThinkingPanel } from "@/components/chat/assistant-thinking-panel";
import { SqlInlinePanel } from "@/components/chat/sql-inline-panel";
import { cn } from "@/lib/utils";

function TextPart({ user }: { user: boolean }) {
  return (
    <p
      className={cn(
        "text-sm leading-relaxed whitespace-pre-wrap",
        user ? "text-[var(--text-primary)]" : "text-[var(--text-primary)]"
      )}
    >
      <MessagePartPrimitive.Text />
    </p>
  );
}

export function UserMessageBubble() {
  return (
    <MessagePrimitive.Root className="flex justify-end py-2">
      <div className="max-w-[85%] rounded-2xl rounded-tr-md border border-[var(--border-brand)] bg-[var(--surface-active)] px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <MessagePrimitive.Parts
          components={{
            Text: () => <TextPart user />
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

interface AssistantMessageBubbleProps {
  run: SqlRun | null;
  streamDelivery?: DeliveryContract;
  runId?: string;
  debugEnabled: boolean;
  thinkingSteps: Array<ExecutionTraceStep & { stage?: ReasoningStage; title?: string }>;
  thinkingInProgress: boolean;
  runLoading?: boolean;
  onRequestRun?: () => void;
  openSqlSignal?: number;
  highlightSql?: boolean;
}

export function AssistantMessageBubble({
  run,
  streamDelivery,
  runId,
  debugEnabled,
  thinkingSteps,
  thinkingInProgress,
  runLoading = false,
  onRequestRun,
  openSqlSignal = 0,
  highlightSql = false
}: AssistantMessageBubbleProps) {
  const [panelSqlOpenSignal, setPanelSqlOpenSignal] = useState(0);
  const resolvedSqlOpenSignal = openSqlSignal + panelSqlOpenSignal;
  const hasRunReference = Boolean(runId);
  const hasResultArtifact = Boolean(run?.delivery?.artifact ?? streamDelivery?.artifact);
  const showUnifiedResultShell =
    hasRunReference || hasResultArtifact || thinkingInProgress || thinkingSteps.length > 0;

  return (
    <MessagePrimitive.Root className="flex justify-start gap-3 py-2">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-brand)] bg-[var(--surface-active)] text-[var(--action-primary)]">
        <Database className="h-4 w-4" />
      </div>
      <div className="min-w-0 max-w-[92%] flex-1">
        <div className="rounded-2xl rounded-tl-md border border-[var(--border-default)] bg-[var(--surface-panel)] px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <MessagePrimitive.Parts
            components={{
              Text: () => <TextPart user={false} />,
              Empty: () => <span className="inline-block h-4 w-2 animate-pulse rounded bg-[var(--text-disabled)]" />
            }}
          />
        </div>
        {showUnifiedResultShell ? (
          <section
            className="mt-3 space-y-2.5 rounded-2xl border border-[var(--chat-result-shell-border)] bg-[var(--chat-result-shell-bg)] p-2.5 shadow-[var(--chat-result-shell-shadow)]"
            data-testid="assistant-result-shell"
            data-run-id={runId ?? undefined}
          >
            <div data-testid="assistant-result-shell-steps">
              <AssistantThinkingPanel
                run={run}
                streamSteps={thinkingSteps}
                inProgress={thinkingInProgress}
                hasRunReference={hasRunReference}
                runLoading={runLoading}
                onRequestRun={onRequestRun}
              />
            </div>
            <div data-testid="assistant-result-shell-answer">
              <ChatBIResultPanel
                run={run}
                streamDelivery={streamDelivery}
                runId={runId}
                openSqlSignal={resolvedSqlOpenSignal}
                onRequestSqlDetails={() => {
                  setPanelSqlOpenSignal((previous) => previous + 1);
                }}
              />
            </div>
          </section>
        ) : null}
        <SqlInlinePanel
          run={run}
          streamDelivery={streamDelivery}
          debugEnabled={debugEnabled}
          openSignal={resolvedSqlOpenSignal}
          highlight={highlightSql}
        />
        {runId ? (
          <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
            同 run 摘要可在
            {" "}
            <a
              href={`/settings?tab=rag&runId=${encodeURIComponent(runId)}`}
              className="font-medium text-[var(--action-primary)] underline-offset-2 hover:underline"
            >
              设置 / RAG 运行与记忆治理
            </a>
            {" "}
            查看。
          </p>
        ) : null}
      </div>
    </MessagePrimitive.Root>
  );
}
