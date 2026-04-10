"use client";

import type { KeyboardEvent } from "react";
import { Loader2, Play, Search, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface MessageComposerProps {
  value: string;
  disabled: boolean;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onOpenDetail?: () => void;
}

export function MessageComposer({
  value,
  disabled,
  loading,
  onChange,
  onSubmit,
  onOpenDetail
}: MessageComposerProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!disabled) {
        onSubmit();
      }
    }
  };

  return (
    <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <div className="rounded-xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-teal-600 focus-within:ring-1 focus-within:ring-teal-600">
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="用自然语言提问，例如：上周哪个门店的退货率最高？"
            aria-label="聊天输入"
            className="min-h-24 resize-none border-none bg-transparent p-2 text-sm shadow-none focus-visible:ring-0"
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
              <Button type="button" size="icon-sm" variant="ghost" aria-label="搜索建议">
                <Search className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                disabled={disabled}
                onClick={onSubmit}
                aria-label="发送"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-slate-400">
          AI 生成结果可能存在偏差，请在关键决策前核实。
        </p>
      </div>
    </div>
  );
}
