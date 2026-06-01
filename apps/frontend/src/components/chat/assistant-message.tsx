"use client";

import type {
  DeliveryContract,
  ExecutionTraceStep,
  ReasoningStage,
  SqlRun
} from "@text2sql/shared-types";
import { MessagePartPrimitive, MessagePrimitive } from "@assistant-ui/react";
import { Loader2, Sparkles } from "lucide-react";
import { ChatBIResultPanel } from "@/components/chat/chatbi-result-panel";
import { AssistantThinkingPanel } from "@/components/chat/assistant-thinking-panel";
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
    <MessagePrimitive.Root className="flex justify-end py-3">
      <div className="max-w-[86%] rounded-2xl rounded-tr-md border border-[var(--border-brand)] bg-[var(--surface-active)] px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:max-w-[74%]">
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
  thinkingSteps: Array<ExecutionTraceStep & { stage?: ReasoningStage; title?: string }>;
  thinkingInProgress: boolean;
  thinkingCancelled?: boolean;
  runLoading?: boolean;
  onRequestRun?: () => void;
  openSqlSignal?: number;
}

export function AssistantMessageBubble({
  run,
  streamDelivery,
  runId,
  thinkingSteps,
  thinkingInProgress,
  thinkingCancelled = false,
  runLoading = false,
  onRequestRun,
  openSqlSignal = 0
}: AssistantMessageBubbleProps) {
  const hasRunReference = Boolean(runId);
  const hasResultArtifact = Boolean(run?.delivery?.artifact ?? streamDelivery?.artifact);
  const showUnifiedResultShell =
    hasRunReference || hasResultArtifact || thinkingInProgress || thinkingSteps.length > 0;

  return (
    <MessagePrimitive.Root className="flex justify-start gap-3 py-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-panel)] text-[var(--action-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 max-w-[100%] flex-1 sm:max-w-[92%]">
        <div className="min-h-7 px-1.5 py-1">
          <MessagePrimitive.Parts
            components={{
              Text: () => <TextPart user={false} />,
              Empty: () => (
                <span className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  <span>正在思考...</span>
                </span>
              )
            }}
          />
        </div>
        {showUnifiedResultShell ? (
          <section
            className="mt-2 space-y-3"
            data-testid="assistant-result-shell"
            data-run-id={runId ?? undefined}
          >
            <div data-testid="assistant-result-shell-steps">
              <AssistantThinkingPanel
                run={run}
                streamSteps={thinkingSteps}
                inProgress={thinkingInProgress}
                cancelled={thinkingCancelled}
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
                openSqlSignal={openSqlSignal}
              />
            </div>
          </section>
        ) : null}
      </div>
    </MessagePrimitive.Root>
  );
}
