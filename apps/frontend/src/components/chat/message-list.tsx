import type { ChatMessage } from "@text2sql/shared-types";
import { cn } from "@/lib/utils";

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <div className="min-h-88 max-h-104 overflow-y-auto rounded-lg border bg-secondary/30 p-3">
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">发送第一条消息开始演示。</p>
      ) : null}
      <div className="space-y-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[90%] rounded-lg border px-3 py-2 text-sm leading-relaxed",
                message.role === "user"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-border bg-card text-card-foreground"
              )}
            >
              <span className="font-semibold">{message.role === "user" ? "你" : "助手"}：</span>
              {message.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
