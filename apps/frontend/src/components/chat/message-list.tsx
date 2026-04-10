"use client";

import type { ChatMessage } from "@text2sql/shared-types";
import { Database } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto bg-white px-4 py-5 sm:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {messages.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            发送第一条消息开始演示。
          </p>
        ) : null}

        {messages.map((message) => {
          const userMessage = message.role === "user";
          return (
            <div key={message.id} className={cn("flex", userMessage ? "justify-end" : "justify-start")}>
              {!userMessage ? (
                <div className="mr-2 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-teal-200 bg-teal-100 text-teal-700">
                  <Database className="h-4 w-4" />
                </div>
              ) : null}

              <div
                className={cn(
                  "max-w-[90%] rounded-xl border px-4 py-3 text-sm leading-relaxed shadow-sm",
                  userMessage
                    ? "rounded-tr-sm border-slate-800 bg-slate-900 text-slate-50"
                    : "rounded-tl-sm border-slate-200 bg-white text-slate-900"
                )}
              >
                {message.content}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
