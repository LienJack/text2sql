"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ChatMessage, SqlRun } from "@text2sql/shared-types";
import { MessageComposer } from "@/components/chat/message-composer";
import { MessageList } from "@/components/chat/message-list";
import { SqlPreview } from "@/components/sql-preview";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { StateBlock } from "@/components/ui/state-block";
import { createSession, getMessages, sendMessage } from "@/lib/api-client";

export function ChatPanel() {
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastRun, setLastRun] = useState<SqlRun | null>(null);
  const [error, setError] = useState<string>("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "success" | "error">(
    "idle"
  );

  useEffect(() => {
    const init = async () => {
      try {
        const session = await createSession();
        setSessionId(session.id);
        setSendState("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "初始化会话失败");
        setSendState("error");
      }
    };
    void init();
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || !sessionId) {
      return;
    }
    setLoading(true);
    setError("");
    setSendState("sending");
    try {
      const latestRunWrapper = await sendMessage(sessionId, input.trim());
      const latestMessages = await getMessages(sessionId);
      setMessages(latestMessages);
      setLastRun(latestRunWrapper.run);
      setInput("");
      setSendState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
      setSendState("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card className="min-h-160">
        <CardHeader>
          <SectionHeader
            title="Text2SQL 演示聊天"
            description={sessionId ? `Session: ${sessionId}` : "Session 初始化中..."}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <MessageList messages={messages} />
          <MessageComposer
            value={input}
            disabled={loading || !sessionId || !input.trim()}
            loading={loading}
            onChange={setInput}
            onSubmit={onSubmit}
          />
          <div className="space-y-2">
            {sendState === "sending" ? <StateBlock variant="loading">正在发送请求...</StateBlock> : null}
            {sendState === "success" ? (
              <StateBlock variant="success">发送成功，已收到后端响应。</StateBlock>
            ) : null}
            {error ? <StateBlock variant="error">{error}</StateBlock> : null}
          </div>
        </CardContent>
      </Card>
      <SqlPreview run={lastRun} />
    </div>
  );
}
