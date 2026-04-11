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
  getRun,
  listEnabledModels,
  listSessions,
  probeModelConnectivity,
  renameSession as renameSessionRequest,
  setSessionModel
} from "@/lib/api-client";

interface ThinkingStateEventData {
  node: string;
  status: ExecutionTraceStep["status"];
  stepId?: string;
  sequence?: number;
  lifecycle?: ExecutionTraceStep["lifecycle"];
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

type ThinkingStep = ExecutionTraceStep & {
  stage?: ReasoningStage;
  title?: string;
};

function toThinkingStep(event: ChatStreamEvent): ThinkingStep | null {
  if (event.type !== "state") {
    return null;
  }
  const payload = event.data as ThinkingStateEventData;
  return {
    node: payload.node,
    status: payload.status,
    stepId: payload.stepId,
    sequence: payload.sequence,
    lifecycle: payload.lifecycle,
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

function appendThinkingStep(
  previous: Record<string, ThinkingStep[]>,
  runId: string,
  incoming: ThinkingStep
): Record<string, ThinkingStep[]> {
  const current = previous[runId] ?? [];
  const stepKey =
    incoming.stepId ??
    `${incoming.node}:${incoming.sequence ?? "na"}:${incoming.at ?? "na"}`;
  const existingIndex = current.findIndex((step) => {
    const existingKey =
      step.stepId ??
      `${step.node}:${step.sequence ?? "na"}:${step.at ?? "na"}`;
    return existingKey === stepKey;
  });

  const nextForRun = [...current];
  if (existingIndex >= 0) {
    nextForRun[existingIndex] = {
      ...nextForRun[existingIndex],
      ...incoming
    };
  } else {
    nextForRun.push(incoming);
  }

  nextForRun.sort((left, right) => {
    const leftSequence = left.sequence ?? 0;
    const rightSequence = right.sequence ?? 0;
    if (leftSequence !== rightSequence) {
      return leftSequence - rightSequence;
    }
    const leftTime = left.at ?? left.startedAt ?? "";
    const rightTime = right.at ?? right.startedAt ?? "";
    return leftTime.localeCompare(rightTime);
  });

  return {
    ...previous,
    [runId]: nextForRun
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
  const [runsById, setRunsById] = useState<Record<string, SqlRun>>({});
  const [streamThinkingByRunId, setStreamThinkingByRunId] = useState<
    Record<string, ThinkingStep[]>
  >({});
  const [runLoadingById, setRunLoadingById] = useState<Record<string, boolean>>(
    {}
  );
  const [activeStreamRunId, setActiveStreamRunId] = useState<string | null>(null);
  const [thinkingRequestPending, setThinkingRequestPending] = useState(false);
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
    const latestRun = sessionView.latestRun;
    if (latestRun) {
      setRunsById((previous) => ({
        ...previous,
        [latestRun.runId]: latestRun
      }));
    }
    setStreamThinkingByRunId({});
    setRunLoadingById({});
    setActiveStreamRunId(null);
    setThinkingRequestPending(false);
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
      setRunsById({});
      setStreamThinkingByRunId({});
      setRunLoadingById({});
      setActiveStreamRunId(null);
      setThinkingRequestPending(false);
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
        setRunsById({});
        setStreamThinkingByRunId({});
        setRunLoadingById({});
        setActiveStreamRunId(null);
        setThinkingRequestPending(false);
        setThreadVersion((previous) => previous + 1);
      }
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
    if (activeSession?.modelCatalogId === modelCatalogId) {
      return;
    }
    setSessionLoading(true);
    setSessionError("");
    try {
      await probeModelConnectivity(modelCatalogId);
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

  const ensureRunLoaded = async (runId: string): Promise<void> => {
    if (!runId || runsById[runId] || runLoadingById[runId]) {
      return;
    }
    setRunLoadingById((previous) => ({
      ...previous,
      [runId]: true
    }));
    try {
      const run = await getRun(runId);
      setRunsById((previous) => ({
        ...previous,
        [runId]: run
      }));
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "加载运行轨迹失败");
    } finally {
      setRunLoadingById((previous) => {
        const next = { ...previous };
        delete next[runId];
        return next;
      });
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
          runsById={runsById}
          streamThinkingByRunId={streamThinkingByRunId}
          runLoadingById={runLoadingById}
          activeStreamRunId={activeStreamRunId}
          thinkingRequestPending={thinkingRequestPending}
          debugEnabled={Boolean(activeSession?.debugEnabled)}
          disabled={sessionLoading || !sessionId}
          onRequestRun={ensureRunLoaded}
          onRunStart={() => {
            setActiveStreamRunId(null);
            setThinkingRequestPending(true);
          }}
          onStreamEvent={(event) => {
            if (event.type === "start") {
              setActiveStreamRunId(event.runId);
              setStreamThinkingByRunId((previous) => ({
                ...previous,
                [event.runId]: []
              }));
              setThinkingRequestPending(true);
              return;
            }
            const step = toThinkingStep(event);
            if (!step) {
              if (event.type === "finish" || event.type === "error") {
                setActiveStreamRunId((current) =>
                  current === event.runId ? null : current
                );
                setThinkingRequestPending(false);
              }
              return;
            }
            setStreamThinkingByRunId((previous) =>
              appendThinkingStep(previous, event.runId, step)
            );
          }}
          onRunFinish={async (runId) => {
            setActiveStreamRunId((current) => (current === runId ? null : current));
            setThinkingRequestPending(false);
            if (!sessionId) {
              return;
            }
            await loadMessages(sessionId);
            if (runId) {
              await ensureRunLoaded(runId);
            }
            await refreshSessions();
          }}
          onRunError={async () => {
            setActiveStreamRunId(null);
            setThinkingRequestPending(false);
            if (sessionId) {
              await loadMessages(sessionId).catch(() => undefined);
            }
          }}
        />
      </section>
    </div>
  );
}
