"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ChatMessage, Session, SqlRun } from "@text2sql/shared-types";
import { MessageComposer } from "@/components/chat/message-composer";
import { MessageList } from "@/components/chat/message-list";
import { SessionSidebar } from "@/components/chat/session-sidebar";
import { SqlPreview } from "@/components/sql-preview";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { StateBlock } from "@/components/ui/state-block";
import {
  createSession,
  deleteSession as deleteSessionRequest,
  getMessages,
  listSessions,
  renameSession as renameSessionRequest,
  setSessionDebugEnabled,
  sendMessage
} from "@/lib/api-client";
import { Switch } from "@/components/ui/switch";

export function ChatPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [lastRun, setLastRun] = useState<SqlRun | null>(null);
  const [error, setError] = useState<string>("");
  const [sessionError, setSessionError] = useState<string>("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "success" | "error">(
    "idle"
  );

  const activeSession = sessions.find((session) => session.id === sessionId);

  const refreshSessions = async (): Promise<Session[]> => {
    const latest = await listSessions();
    setSessions(latest);
    return latest;
  };

  const loadMessages = async (targetSessionId: string): Promise<void> => {
    const sessionView = await getMessages(targetSessionId);
    setMessages(sessionView.messages);
    setLastRun(sessionView.latestRun ?? null);
    setSessions((previous) => {
      const index = previous.findIndex(
        (session) => session.id === sessionView.session.id
      );
      if (index < 0) {
        return [sessionView.session, ...previous];
      }
      const next = [...previous];
      next[index] = {
        ...next[index],
        ...sessionView.session
      };
      return next;
    });
  };

  useEffect(() => {
    const init = async () => {
      setSessionLoading(true);
      setSessionError("");
      try {
        let latestSessions = await refreshSessions();
        if (latestSessions.length === 0) {
          const created = await createSession();
          latestSessions = [created];
          setSessions(latestSessions);
        }
        const initialSessionId = latestSessions[0]?.id ?? "";
        if (initialSessionId) {
          setSessionId(initialSessionId);
          await loadMessages(initialSessionId);
        }
        setSendState("idle");
      } catch (err) {
        setSessionError(err instanceof Error ? err.message : "初始化会话失败");
        setSendState("error");
      } finally {
        setSessionLoading(false);
      }
    };
    void init();
  }, []);

  const onSelectSession = async (targetSessionId: string) => {
    setSessionLoading(true);
    setSessionError("");
    setError("");
    setSendState("idle");
    try {
      setSessionId(targetSessionId);
      await loadMessages(targetSessionId);
    } catch (sessionSelectError) {
      setSessionError(sessionSelectError instanceof Error ? sessionSelectError.message : "加载会话失败");
    } finally {
      setSessionLoading(false);
    }
  };

  const onCreateSession = async () => {
    setSessionLoading(true);
    setSessionError("");
    try {
      const created = await createSession();
      const latest = await refreshSessions();
      setSessionId(created.id);
      setMessages([]);
      setLastRun(null);
      setInput("");
      setSendState("idle");
      if (!latest.some((session) => session.id === created.id)) {
        setSessions([created, ...latest]);
      }
    } catch (createError) {
      setSessionError(createError instanceof Error ? createError.message : "创建会话失败");
    } finally {
      setSessionLoading(false);
    }
  };

  const onRenameSession = async (targetSessionId: string, title: string) => {
    await renameSessionRequest(targetSessionId, title);
    await refreshSessions();
  };

  const onDeleteSession = async (targetSessionId: string) => {
    setSessionLoading(true);
    setSessionError("");
    try {
      await deleteSessionRequest(targetSessionId);
      const latest = await refreshSessions();
      const deletingActive = targetSessionId === sessionId;
      if (!deletingActive) {
        return;
      }
      const nextSessionId = latest[0]?.id;
      if (nextSessionId) {
        setSessionId(nextSessionId);
        await loadMessages(nextSessionId);
      } else {
        const created = await createSession();
        setSessions([created]);
        setSessionId(created.id);
        setMessages([]);
      }
      setLastRun(null);
    } catch (deleteError) {
      setSessionError(deleteError instanceof Error ? deleteError.message : "删除会话失败");
    } finally {
      setSessionLoading(false);
    }
  };

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
      await loadMessages(sessionId);
      await refreshSessions();
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

  const onDebugToggle = async (enabled: boolean): Promise<void> => {
    if (!sessionId) {
      return;
    }
    setSessionLoading(true);
    setSessionError("");
    try {
      const updated = await setSessionDebugEnabled(sessionId, enabled);
      setSessions((previous) =>
        previous.map((session) =>
          session.id === updated.id ? { ...session, ...updated } : session
        )
      );
    } catch (toggleError) {
      setSessionError(toggleError instanceof Error ? toggleError.message : "更新调试开关失败");
    } finally {
      setSessionLoading(false);
    }
  };

  return (
    <SidebarProvider defaultOpen>
      <SessionSidebar
        sessions={sessions}
        activeSessionId={sessionId}
        loading={sessionLoading}
        error={sessionError}
        onSelectSession={onSelectSession}
        onCreateSession={onCreateSession}
        onRenameSession={onRenameSession}
        onDeleteSession={onDeleteSession}
      />
      <SidebarInset>
        <div className="grid gap-4 p-2 md:p-4 lg:grid-cols-[1.2fr_1fr]">
          <Card className="min-h-160">
            <CardHeader>
              <SectionHeader
                title="Text2SQL 演示聊天"
                description={sessionId ? `Session: ${sessionId}` : "Session 初始化中..."}
                action={<SidebarTrigger className="md:hidden" />}
              />
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">调试详情</p>
                  <p className="text-xs text-muted-foreground">
                    开启后展示 LLM 原始返回与步骤明细
                  </p>
                </div>
                <Switch
                  checked={Boolean(activeSession?.debugEnabled)}
                  disabled={sessionLoading || !sessionId}
                  aria-label="调试详情开关"
                  onCheckedChange={(checked) => {
                    void onDebugToggle(checked);
                  }}
                />
              </div>
              {activeSession?.syncStatus === "degraded" ? (
                <StateBlock variant="error">当前会话存在待同步异常，请稍后重试。</StateBlock>
              ) : null}
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
                {sendState === "sending" ? (
                  <StateBlock variant="loading">正在发送请求...</StateBlock>
                ) : null}
                {sendState === "success" ? (
                  <StateBlock variant="success">发送成功，已收到后端响应。</StateBlock>
                ) : null}
                {error ? <StateBlock variant="error">{error}</StateBlock> : null}
              </div>
            </CardContent>
          </Card>
          <SqlPreview run={lastRun} debugEnabled={Boolean(activeSession?.debugEnabled)} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
