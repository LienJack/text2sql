"use client";

import { useRef } from "react";
import { ComposerPrimitive } from "@assistant-ui/react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssistantComposerProps {
  disabled?: boolean;
}

export function AssistantComposer({
  disabled = false
}: AssistantComposerProps) {
  const imeSubmitPending = useRef(false);

  return (
    <div className="bg-transparent px-2 pb-4 sm:px-6">
      <div className="mx-auto w-full max-w-4xl space-y-3">
        <ComposerPrimitive.Root
          className={cn(
            "rounded-[16px] border border-[var(--border-strong)] bg-[var(--surface-panel)] p-2 shadow-[0_1px_3px_rgba(15,23,42,0.06)] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
            disabled ? "pointer-events-none opacity-60" : null
          )}
        >
          <ComposerPrimitive.Input
            placeholder="用自然语言提问，例如：上周哪个门店的退货率最高？"
            aria-label="聊天输入"
            submitMode="enter"
            disabled={disabled}
            onKeyDown={(event) => {
              const composing =
                event.nativeEvent.isComposing ||
                Boolean((event as unknown as { isComposing?: boolean }).isComposing);
              const isImeConfirmKey =
                event.key === "Enter" ||
                event.key === "Process" ||
                event.code === "Enter";
              if (
                isImeConfirmKey &&
                !event.shiftKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                composing
              ) {
                imeSubmitPending.current = true;
              } else if (event.key !== "Process") {
                imeSubmitPending.current = false;
              }
            }}
            onCompositionEnd={(event) => {
              if (!imeSubmitPending.current || disabled) {
                return;
              }
              imeSubmitPending.current = false;
              const inputElement = event.currentTarget;
              if (!inputElement.value.trim()) {
                return;
              }
              queueMicrotask(() => {
                inputElement.closest("form")?.requestSubmit();
              });
            }}
            className="min-h-24 w-full resize-none border-none bg-transparent p-3 text-sm shadow-none focus-visible:ring-0 focus-visible:outline-none"
          />
          <div className="flex items-center justify-between px-2 pb-1">
            <p className="text-xs text-[var(--text-tertiary)]">Shift + Enter 换行，Enter 发送</p>
            <ComposerPrimitive.Send
              aria-label="发送"
              className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary text-primary-foreground transition hover:bg-[var(--action-primary-hover)] disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5" />
            </ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
        <p className="text-center text-xs text-[var(--text-tertiary)]">
          AI 生成结果可能存在偏差，请在关键决策前核实。
        </p>
      </div>
    </div>
  );
}
