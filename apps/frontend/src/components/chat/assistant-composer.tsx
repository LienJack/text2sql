"use client";

import { ComposerPrimitive } from "@assistant-ui/react";
import { Play, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AssistantComposerProps {
  disabled?: boolean;
  onOpenDetail?: () => void;
}

export function AssistantComposer({
  disabled = false,
  onOpenDetail
}: AssistantComposerProps) {
  return (
    <div className="bg-transparent px-2 pb-4 sm:px-6">
      <div className="mx-auto w-full max-w-4xl space-y-3">
        <ComposerPrimitive.Root
          className={cn(
            "rounded-[1.5rem] border border-slate-300/90 bg-white p-2 shadow-[0_8px_30px_rgba(0,0,0,0.08)] focus-within:border-teal-600 focus-within:ring-1 focus-within:ring-teal-600",
            disabled ? "pointer-events-none opacity-60" : null
          )}
        >
          <ComposerPrimitive.Input
            placeholder="用自然语言提问，例如：上周哪个门店的退货率最高？"
            aria-label="聊天输入"
            submitMode="enter"
            disabled={disabled}
            className="min-h-24 w-full resize-none border-none bg-transparent p-3 text-sm shadow-none focus-visible:ring-0 focus-visible:outline-none"
          />
          <div className="flex items-center justify-between px-2 pb-1">
            <p className="text-xs text-slate-400">Shift + Enter 换行，Enter 发送</p>
            <div className="flex items-center gap-2">
              {onOpenDetail ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="lg:hidden"
                  onClick={onOpenDetail}
                >
                  <Terminal className="h-3.5 w-3.5" />
                  结果详情
                </Button>
              ) : null}
              <ComposerPrimitive.Send
                aria-label="发送"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-slate-50 transition hover:bg-slate-800 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" />
              </ComposerPrimitive.Send>
            </div>
          </div>
        </ComposerPrimitive.Root>
        <p className="text-center text-xs text-slate-400">
          AI 生成结果可能存在偏差，请在关键决策前核实。
        </p>
      </div>
    </div>
  );
}
