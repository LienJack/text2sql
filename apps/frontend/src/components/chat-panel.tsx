"use client";

import { useEffect, useState } from "react";
import type { ChatMessage, Session, SqlRun } from "@text2sql/shared-types";
import { Menu, Terminal } from "lucide-react";
import { MessageComposer } from "@/components/chat/message-composer";
import { MessageList } from "@/components/chat/message-list";
import { SessionSidebar } from "@/components/chat/session-sidebar";
import { SqlPreview } from "@/components/sql-preview";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StateBlock } from "@/components/ui/state-block";
import { Switch } from "@/components/ui/switch";
import {
  createSession,
  deleteSession as deleteSessionRequest,
  getMessages,
  listSessions,
  renameSession as renameSessionRequest,
  sendMessage,
  setSessionDebugEnabled
} from "@/lib/api-client";

export function ChatPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [lastRun, setLastRun] = useState<SqlRun | null>(null);
  const [error, setError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [mobileSqlOpen, setMobileSqlOpen] = useState(false);

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
      const index = previous.findIndex((session) => session.id === sessionView.session.id);
      if (index < 0) {
        return [sessionView.session, ...previous];
      }
      const next = [...previous];
      next[index] = { ...next[index], ...sessionView.session };
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
      } catch (initError) {
        setSessionError(initError instanceof Error ? initError.message : "初始化会话失败");
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
      setMobileSessionsOpen(false);
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
      setMobileSessionsOpen(false);
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
      if (targetSessionId !== sessionId) {
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

  const onSubmit = async () => {
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
      if (window.matchMedia("(max-width: 1023px)").matches) {
        setMobileSqlOpen(true);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "发送失败");
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
        previous.map((session) => (session.id === updated.id ? { ...session, ...updated } : session))
      );
    } catch (toggleError) {
      setSessionError(toggleError instanceof Error ? toggleError.message : "更新调试开关失败");
    } finally {
      setSessionLoading(false);
    }
  };

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-white text-slate-950">
      <aside className="hidden h-full w-64 border-r border-slate-200 bg-slate-50/50 md:block">
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
      </aside>

      <Sheet open={mobileSessionsOpen} onOpenChange={setMobileSessionsOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetTitle className="sr-only">会话列表</SheetTitle>
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
        </SheetContent>
      </Sheet>

      <section className="relative flex min-w-0 flex-1 flex-col bg-white">
        <header className="space-y-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-900">Text2SQL 演示聊天</h2>
              <p className="truncate text-xs text-slate-500">
                {sessionId ? `Session: ${sessionId}` : "Session 初始化中..."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="md:hidden"
                onClick={() => setMobileSessionsOpen(true)}
              >
                <Menu className="h-3.5 w-3.5" />
                会话
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="lg:hidden"
                onClick={() => setMobileSqlOpen(true)}
              >
                <Terminal className="h-3.5 w-3.5" />
                详情
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-slate-900">调试详情</p>
              <p className="text-xs text-slate-500">开启后展示 LLM 原始返回与步骤明细</p>
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
          {sendState === "sending" ? <StateBlock variant="loading">正在发送请求...</StateBlock> : null}
          {sendState === "success" ? <StateBlock variant="success">发送成功，已收到后端响应。</StateBlock> : null}
          {sendState === "error" || error ? (
            <StateBlock variant="error">{error || "发送失败，请稍后重试。"}</StateBlock>
          ) : null}
        </header>

        <MessageList messages={messages} />
        <MessageComposer
          value={input}
          disabled={loading || !sessionId || !input.trim()}
          loading={loading}
          onChange={setInput}
          onSubmit={onSubmit}
          onOpenDetail={() => setMobileSqlOpen(true)}
        />
      </section>

      <aside className="hidden h-full w-80 border-l border-slate-200 bg-slate-50/50 lg:block xl:w-[440px]">
        <SqlPreview run={lastRun} debugEnabled={Boolean(activeSession?.debugEnabled)} />
      </aside>

      {mobileSqlOpen ? (
        <>
          <button
            type="button"
            aria-label="关闭详情"
            className="fixed inset-0 z-30 bg-slate-950/60 lg:hidden"
            onClick={() => setMobileSqlOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 z-40 w-80 max-w-[92vw] border-l border-slate-200 bg-slate-50/50 shadow-xl lg:hidden">
            <SqlPreview
              run={lastRun}
              debugEnabled={Boolean(activeSession?.debugEnabled)}
              onClose={() => setMobileSqlOpen(false)}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
