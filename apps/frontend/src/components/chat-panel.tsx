"use client";

import { useEffect, useState } from "react";
import type {
  ChatMessage,
  ChatStreamEvent,
  ExecutionTraceStep,
  ModelCatalogItem,
  ReasoningStage,
  Session,
  SqlRun
} from "@text2sql/shared-types";
import { Menu } from "lucide-react";
import { AssistantThread } from "@/components/chat/assistant-thread";
import { ModelSelector } from "@/components/chat/model-selector";
import { SessionSidebar } from "@/components/chat/session-sidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StateBlock } from "@/components/ui/state-block";
import {
  createSession,
  deleteSession as deleteSessionRequest,
  getMessages,
  listEnabledModels,
  listSessions,
  renameSession as renameSessionRequest,
  setSessionModel
} from "@/lib/api-client";

interface ThinkingStateEventData {
  node: string;
  status: ExecutionTraceStep["status"];
  detail: string;
  stage?: ReasoningStage;
  title?: string;
  at?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  errorSummary?: string;
}

function toThinkingStep(event: ChatStreamEvent): (ExecutionTraceStep & { stage?: ReasoningStage; title?: string }) | null {
  if (event.type !== "state") {
    return null;
  }
  const payload = event.data as ThinkingStateEventData;
  return {
    node: payload.node,
    status: payload.status,
    detail: payload.detail,
    at: payload.at ?? event.at,
    startedAt: payload.startedAt,
    endedAt: payload.endedAt,
    durationMs: payload.durationMs,
    inputSummary: payload.inputSummary,
    outputSummary: payload.outputSummary,
    errorSummary: payload.errorSummary,
    stage: payload.stage,
    title: payload.title
  };
}

function mergeSessionMessages(
  previous: ChatMessage[],
  incoming: ChatMessage[],
  sessionId: string
): ChatMessage[] {
  const merged = new Map<string, ChatMessage>();
  for (const message of previous) {
    if (message.sessionId !== sessionId) {
      continue;
    }
    merged.set(message.id, message);
  }
  for (const message of incoming) {
    if (message.sessionId !== sessionId) {
      continue;
    }
    merged.set(message.id, message);
  }
  return Array.from(merged.values()).sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );
}

export function ChatPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [lastRun, setLastRun] = useState<SqlRun | null>(null);
  const [thinkingSteps, setThinkingSteps] = useState<
    Array<ExecutionTraceStep & { stage?: ReasoningStage; title?: string }>
  >([]);
  const [thinkingInProgress, setThinkingInProgress] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelCatalogItem[]>([]);
  const [sessionError, setSessionError] = useState("");
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [threadVersion, setThreadVersion] = useState(0);

  const activeSession = sessions.find((session) => session.id === sessionId);

  const refreshSessions = async (): Promise<Session[]> => {
    const latest = await listSessions();
    setSessions(latest);
    return latest;
  };

  const refreshModels = async (): Promise<ModelCatalogItem[]> => {
    const models = await listEnabledModels();
    setAvailableModels(models);
    return models;
  };

  const loadMessages = async (targetSessionId: string): Promise<void> => {
    const sessionView = await getMessages(targetSessionId);
    setMessages((previous) =>
      mergeSessionMessages(previous, sessionView.messages, targetSessionId)
    );
    setLastRun(sessionView.latestRun ?? null);
    setThinkingSteps([]);
    setThinkingInProgress(false);
    setThreadVersion((previous) => previous + 1);
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
        await refreshModels();
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
      } catch (initError) {
        setSessionError(initError instanceof Error ? initError.message : "初始化会话失败");
      } finally {
        setSessionLoading(false);
      }
    };
    void init();
  }, []);

  const onSelectSession = async (targetSessionId: string) => {
    setSessionLoading(true);
    setSessionError("");
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
      setThinkingSteps([]);
      setThinkingInProgress(false);
      setThreadVersion((previous) => previous + 1);
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
        setThinkingSteps([]);
        setThinkingInProgress(false);
        setThreadVersion((previous) => previous + 1);
      }
      setLastRun(null);
    } catch (deleteError) {
      setSessionError(deleteError instanceof Error ? deleteError.message : "删除会话失败");
    } finally {
      setSessionLoading(false);
    }
  };

  const onSessionModelChange = async (modelCatalogId: string): Promise<void> => {
    if (!sessionId || !modelCatalogId) {
      return;
    }
    setSessionLoading(true);
    setSessionError("");
    try {
      const updated = await setSessionModel(sessionId, modelCatalogId);
      setSessions((previous) =>
        previous.map((session) => (session.id === updated.id ? { ...session, ...updated } : session))
      );
      await refreshModels();
    } catch (switchError) {
      setSessionError(switchError instanceof Error ? switchError.message : "切换模型失败");
    } finally {
      setSessionLoading(false);
    }
  };

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-[var(--surface-page)] text-[var(--text-primary)]">
      <aside className="hidden h-full w-80 border-r border-[var(--border-default)] bg-[var(--surface-sidebar)] md:block">
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
        <SheetContent side="left" className="w-80 border-[var(--border-default)] bg-[var(--surface-sidebar)] p-0">
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

      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--surface-page)]">
        <header className="space-y-3 border-b border-[var(--border-default)] bg-[var(--surface-panel)] px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-[var(--text-primary)]">Text2SQL Assistant</h2>
              <p className="truncate text-xs text-[var(--text-tertiary)]">
                {sessionId ? `Session: ${sessionId}` : "Session 初始化中..."}
              </p>
            </div>
            <div className="hidden md:block">
              <ModelSelector
                models={availableModels}
                value={activeSession?.modelCatalogId ?? undefined}
                disabled={sessionLoading || !sessionId}
                onChange={(modelCatalogId) => {
                  void onSessionModelChange(modelCatalogId);
                }}
              />
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
            </div>
          </div>

          <div className="md:hidden">
            <ModelSelector
              models={availableModels}
              value={activeSession?.modelCatalogId ?? undefined}
              disabled={sessionLoading || !sessionId}
              onChange={(modelCatalogId) => {
                void onSessionModelChange(modelCatalogId);
              }}
            />
          </div>

          {activeSession?.syncStatus === "degraded" ? (
            <StateBlock variant="error">当前会话存在待同步异常，请稍后重试。</StateBlock>
          ) : null}
        </header>

        <AssistantThread
          key={`${sessionId}-${threadVersion}`}
          sessionId={sessionId}
          messages={messages}
          run={lastRun}
          thinkingSteps={thinkingSteps}
          thinkingInProgress={thinkingInProgress}
          debugEnabled={Boolean(activeSession?.debugEnabled)}
          disabled={sessionLoading || !sessionId}
          onRunStart={() => {
            setLastRun(null);
            setThinkingSteps([]);
            setThinkingInProgress(true);
          }}
          onStreamEvent={(event) => {
            const step = toThinkingStep(event);
            if (!step) {
              return;
            }
            setThinkingSteps((previous) => [...previous, step]);
          }}
          onRunFinish={async () => {
            setThinkingInProgress(false);
            if (!sessionId) {
              return;
            }
            await loadMessages(sessionId);
            await refreshSessions();
          }}
          onRunError={async () => {
            setThinkingInProgress(false);
            if (sessionId) {
              await loadMessages(sessionId).catch(() => undefined);
            }
          }}
        />
      </section>
    </div>
  );
}
