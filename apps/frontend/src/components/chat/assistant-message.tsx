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
        user ? "text-slate-50" : "text-slate-900"
      )}
    >
      <MessagePartPrimitive.Text />
    </p>
  );
}

export function UserMessageBubble() {
  return (
    <MessagePrimitive.Root className="flex justify-end py-2">
      <div className="max-w-[85%] rounded-3xl rounded-tr-md border border-zinc-900 bg-zinc-900 px-4 py-3 text-white shadow-sm">
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
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-teal-200/70 bg-teal-100/90 text-teal-700">
        <Database className="h-4 w-4" />
      </div>
      <div className="min-w-0 max-w-[92%] flex-1">
        <div className="rounded-2xl rounded-tl-md border border-slate-200/90 bg-white px-4 py-3 shadow-sm">
          <MessagePrimitive.Parts
            components={{
              Text: () => <TextPart user={false} />,
              Empty: () => <span className="inline-block h-4 w-2 animate-pulse rounded bg-slate-300" />
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
