"use client";

import type { SqlRun } from "@text2sql/shared-types";
import { MessagePartPrimitive, MessagePrimitive } from "@assistant-ui/react";
import { Database } from "lucide-react";
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
  debugEnabled: boolean;
  openSqlSignal?: number;
  highlightSql?: boolean;
}

export function AssistantMessageBubble({
  run,
  debugEnabled,
  openSqlSignal = 0,
  highlightSql = false
}: AssistantMessageBubbleProps) {
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
        <SqlInlinePanel
          run={run}
          debugEnabled={debugEnabled}
          openSignal={openSqlSignal}
          highlight={highlightSql}
        />
      </div>
    </MessagePrimitive.Root>
  );
}
