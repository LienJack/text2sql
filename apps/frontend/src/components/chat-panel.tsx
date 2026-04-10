"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ChatMessage, SqlRun } from "@text2sql/shared-types";
import { createSession, getMessages, sendMessage } from "../lib/api-client";
import { SqlPreview } from "./sql-preview";

export function ChatPanel() {
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastRun, setLastRun] = useState<SqlRun | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const init = async () => {
      try {
        const session = await createSession();
        setSessionId(session.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "初始化会话失败");
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
    try {
      const latestRunWrapper = await sendMessage(sessionId, input.trim());
      const latestMessages = await getMessages(sessionId);
      setMessages(latestMessages);
      setLastRun(latestRunWrapper.run);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.2fr 1fr",
        gap: 16,
        padding: 16,
        maxWidth: 1400,
        margin: "0 auto"
      }}
    >
      <section
        style={{
          border: "1px solid #d0d5dd",
          borderRadius: 8,
          background: "#fff",
          padding: 16,
          minHeight: 640
        }}
      >
        <h2 style={{ marginTop: 0 }}>Text2SQL 演示聊天</h2>
        <p style={{ color: "#475467" }}>Session: {sessionId || "初始化中..."}</p>
        <div
          style={{
            border: "1px solid #e4e7ec",
            borderRadius: 8,
            minHeight: 420,
            maxHeight: 420,
            overflowY: "auto",
            padding: 12,
            background: "#f8fafc"
          }}
        >
          {messages.length === 0 ? <p>发送第一条消息开始演示。</p> : null}
          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                marginBottom: 12,
                textAlign: message.role === "user" ? "right" : "left"
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  background: message.role === "user" ? "#d1fadf" : "#ffffff",
                  border: "1px solid #d0d5dd",
                  borderRadius: 8,
                  padding: "8px 12px",
                  maxWidth: "90%"
                }}
              >
                <strong>{message.role === "user" ? "你" : "助手"}：</strong>
                {message.content}
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={onSubmit} style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="例如：近30天支付方式分布"
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #d0d5dd"
            }}
          />
          <button
            type="submit"
            disabled={loading || !sessionId}
            style={{
              borderRadius: 8,
              border: "none",
              padding: "10px 16px",
              background: "#175cd3",
              color: "white",
              cursor: "pointer"
            }}
          >
            {loading ? "发送中..." : "发送"}
          </button>
        </form>
        {error ? <p style={{ color: "#b42318" }}>{error}</p> : null}
      </section>
      <SqlPreview run={lastRun} />
    </div>
  );
}
