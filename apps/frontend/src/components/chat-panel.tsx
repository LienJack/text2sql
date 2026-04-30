"use client";

import { useEffect, useState } from "react";
import type {
  ChatSessionView,
  ChatMessage,
  DeliveryContract,
  ModelCatalogItem,
  Session,
  SqlRun
} from "@text2sql/shared-types";
import { Menu } from "lucide-react";
import { AssistantThread } from "@/components/chat/assistant-thread";
import { SaveAsViewDialog } from "@/components/chat/save-as-view-dialog";
import {
  mergeRunThinkingSteps,
  normalizeDeliveryContract,
  normalizeRunForVisibility,
  projectStreamEvent,
  toRunVisibilityStatusFromRunStatus,
  transitionRunVisibilityStatus,
  type RunVisibilityStatus,
  type RunVisibilityThinkingStep
} from "@/components/chat/run-visibility-mapper";
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
import {
  readActiveDatasourceId,
  readActiveWorkspaceId,
  readChatRouteContext,
  replaceChatRouteContext,
  writeActiveDatasourceId
} from "@/lib/datasource-session-context";

type ThinkingStep = RunVisibilityThinkingStep;

const DATASOURCE_READONLY_STATUSES = new Set(["unavailable", "deleted"]);
const SESSION_ERROR_CODES = new Set(["SESSION_NOT_FOUND", "VALIDATION_ERROR"]);
const DATASOURCE_ERROR_CODES = new Set([
  "DATASOURCE_NOT_FOUND",
  "DATASOURCE_UNAVAILABLE"
]);

function extractErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return "";
  }
  const matched = error.message.match(/\[([A-Z_]+)\]/);
  return matched?.[1] ?? "";
}

function isReadonlySession(session: Session): boolean {
  return Boolean(
    session.datasourceStatus &&
      DATASOURCE_READONLY_STATUSES.has(session.datasourceStatus)
  );
}

function dedupeSessions(candidates: Session[]): Session[] {
  const seen = new Set<string>();
  const next: Session[] = [];
  for (const session of candidates) {
    if (!session.id || seen.has(session.id)) {
      continue;
    }
    seen.add(session.id);
    next.push(session);
  }
  return next;
}

function moveSessionToFront(
  sessions: Session[],
  target: Session,
  include: boolean
): Session[] {
  const next = sessions.filter((session) => session.id !== target.id);
  if (!include) {
    return next;
  }
  return [target, ...next];
}

function appendThinkingStep(
  previous: Record<string, ThinkingStep[]>,
  runId: string,
  incoming: ThinkingStep
): Record<string, ThinkingStep[]> {
  const current = previous[runId] ?? [];
  const nextForRun = mergeRunThinkingSteps(undefined, [...current, incoming]) as ThinkingStep[];

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
  const [writableSessions, setWritableSessions] = useState<Session[]>([]);
  const [readonlySessions, setReadonlySessions] = useState<Session[]>([]);
  const [datasourceId, setDatasourceId] = useState("");
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
  const [streamDeliveryByRunId, setStreamDeliveryByRunId] = useState<
    Record<string, DeliveryContract>
  >({});
  const [streamTextStartedByRunId, setStreamTextStartedByRunId] = useState<
    Record<string, boolean>
  >({});
  const [runVisibilityByRunId, setRunVisibilityByRunId] = useState<
    Record<string, RunVisibilityStatus>
  >({});
  const [activeStreamRunId, setActiveStreamRunId] = useState<string | null>(null);
  const [thinkingRequestPending, setThinkingRequestPending] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelCatalogItem[]>([]);
  const [sessionError, setSessionError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveTargetRunId, setSaveTargetRunId] = useState("");
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [threadVersion, setThreadVersion] = useState(0);

  const allSessions = dedupeSessions([...writableSessions, ...readonlySessions]);
  const activeSession = allSessions.find((session) => session.id === sessionId);
  const latestSqlRun = Object.values(runsById)
    .filter((item) => Boolean(item.sql?.trim()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const saveWorkspaceId =
    activeSession?.workspaceId?.trim() || readActiveWorkspaceId();
  const canSaveAsView = Boolean(
    latestSqlRun?.runId && datasourceId.trim() && saveWorkspaceId.trim()
  );

  const refreshSessionBuckets = async (
    targetDatasourceId = datasourceId
  ): Promise<{ writable: Session[]; readonly: Session[] }> => {
    if (!targetDatasourceId) {
      setWritableSessions([]);
      setReadonlySessions([]);
      return {
        writable: [],
        readonly: []
      };
    }
    const [currentCandidates, readonlyCandidates] = await Promise.all([
      listSessions({
        datasource: targetDatasourceId,
        view: "current"
      }),
      listSessions({
        view: "readonly-history"
      })
    ]);

    const candidates = dedupeSessions([...currentCandidates, ...readonlyCandidates]);
    const writable = candidates.filter(
      (session) =>
        session.datasource === targetDatasourceId && !isReadonlySession(session)
    );
    const readonly = candidates.filter((session) => isReadonlySession(session));

    setWritableSessions(writable);
    setReadonlySessions(readonly);
    return {
      writable,
      readonly
    };
  };

  const refreshModels = async (): Promise<ModelCatalogItem[]> => {
    const models = await listEnabledModels();
    setAvailableModels(models);
    return models;
  };

  const resetThreadState = (nextMessages: ChatMessage[] = []) => {
    setMessages(nextMessages);
    setRunsById({});
    setStreamThinkingByRunId({});
    setRunLoadingById({});
    setStreamDeliveryByRunId({});
    setStreamTextStartedByRunId({});
    setRunVisibilityByRunId({});
    setActiveStreamRunId(null);
    setThinkingRequestPending(false);
    setSaveNotice("");
    setThreadVersion((previous) => previous + 1);
  };

  const applySessionView = (
    sessionView: ChatSessionView,
    contextDatasourceId: string
  ): void => {
    setMessages((previous) =>
      mergeSessionMessages(previous, sessionView.messages, sessionView.session.id)
    );
    if (sessionView.latestRun) {
      const latestRun = normalizeRunForVisibility(sessionView.latestRun);
      setRunsById((previous) => ({
        ...previous,
        [latestRun.runId]: latestRun
      }));
    }
    setStreamThinkingByRunId({});
    setRunLoadingById({});
    setStreamDeliveryByRunId({});
    setStreamTextStartedByRunId({});
    setRunVisibilityByRunId((previous) => {
      if (!sessionView.latestRun) {
        return {};
      }
      const runId = sessionView.latestRun.runId;
      const runStatus = toRunVisibilityStatusFromRunStatus(sessionView.latestRun.status);
      if (!runStatus) {
        return {};
      }
      const previousStatus = previous[runId];
      return {
        [runId]: transitionRunVisibilityStatus(previousStatus, runStatus) ?? runStatus
      };
    });
    setActiveStreamRunId(null);
    setThinkingRequestPending(false);
    setThreadVersion((previous) => previous + 1);
    setWritableSessions((previous) => {
      const include =
        sessionView.session.datasource === contextDatasourceId &&
        !isReadonlySession(sessionView.session);
      return moveSessionToFront(previous, sessionView.session, include);
    });
    setReadonlySessions((previous) => {
      const include = isReadonlySession(sessionView.session);
      return moveSessionToFront(previous, sessionView.session, include);
    });
  };

  const loadMessages = async (
    targetSessionId: string,
    contextDatasourceId = datasourceId
  ): Promise<ChatSessionView> => {
    const sessionView = await getMessages(targetSessionId);
    applySessionView(sessionView, contextDatasourceId);
    return sessionView;
  };

  useEffect(() => {
    const init = async () => {
      setSessionLoading(true);
      setSessionError("");
      try {
        const { datasourceId: queryDatasourceId, sessionId: querySessionId } =
          readChatRouteContext();
        const storedDatasourceId = readActiveDatasourceId();
        let resolvedDatasourceId = queryDatasourceId || storedDatasourceId;

        const redirectToDatasourcePage = () => {
          writeActiveDatasourceId("");
          window.location.replace("/data-sources");
        };

        await refreshModels();

        if (querySessionId) {
          try {
            const sessionView = await getMessages(querySessionId);
            const boundDatasourceId = sessionView.session.datasource.trim();
            if (!boundDatasourceId) {
              redirectToDatasourcePage();
              return;
            }

            resolvedDatasourceId = boundDatasourceId;
            writeActiveDatasourceId(boundDatasourceId);
            setDatasourceId(boundDatasourceId);
            replaceChatRouteContext({
              datasourceId: boundDatasourceId,
              sessionId: sessionView.session.id
            });

            await refreshSessionBuckets(boundDatasourceId);
            setSessionId(sessionView.session.id);
            applySessionView(sessionView, boundDatasourceId);
            return;
          } catch (error) {
            const code = extractErrorCode(error);
            if (!SESSION_ERROR_CODES.has(code)) {
              throw error;
            }
            if (queryDatasourceId) {
              resolvedDatasourceId = queryDatasourceId;
              replaceChatRouteContext({
                datasourceId: queryDatasourceId
              });
            } else {
              redirectToDatasourcePage();
              return;
            }
          }
        }

        if (!resolvedDatasourceId) {
          setSessionError("请先选择数据源后再进入聊天。");
          redirectToDatasourcePage();
          return;
        }

        writeActiveDatasourceId(resolvedDatasourceId);
        setDatasourceId(resolvedDatasourceId);
        replaceChatRouteContext({
          datasourceId: resolvedDatasourceId
        });

        const latest = await refreshSessionBuckets(resolvedDatasourceId);
        const initialSessionId = latest.writable[0]?.id ?? "";
        if (!initialSessionId) {
          setSessionId("");
          resetThreadState([]);
          return;
        }
        setSessionId(initialSessionId);
        replaceChatRouteContext({
          datasourceId: resolvedDatasourceId,
          sessionId: initialSessionId
        });
        await loadMessages(initialSessionId, resolvedDatasourceId);
      } catch (initError) {
        const code = extractErrorCode(initError);
        if (DATASOURCE_ERROR_CODES.has(code)) {
          writeActiveDatasourceId("");
          setSessionError("会话上下文对应的数据源不可用，请重新选择。");
          window.location.replace("/data-sources");
          return;
        }
        setSessionError(initError instanceof Error ? initError.message : "初始化会话失败");
      } finally {
        setSessionLoading(false);
      }
    };
    void init();
    // We intentionally initialize once on mount; callbacks use latest state updates internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSelectSession = async (targetSessionId: string) => {
    setSessionLoading(true);
    setSessionError("");
    try {
      setSessionId(targetSessionId);
      const sessionView = await loadMessages(targetSessionId, datasourceId);
      const boundDatasourceId = sessionView.session.datasource.trim();
      if (boundDatasourceId && boundDatasourceId !== datasourceId) {
        writeActiveDatasourceId(boundDatasourceId);
        setDatasourceId(boundDatasourceId);
        await refreshSessionBuckets(boundDatasourceId);
      }
      replaceChatRouteContext({
        datasourceId: boundDatasourceId || datasourceId,
        sessionId: targetSessionId
      });
      setMobileSessionsOpen(false);
    } catch (sessionSelectError) {
      setSessionError(sessionSelectError instanceof Error ? sessionSelectError.message : "加载会话失败");
    } finally {
      setSessionLoading(false);
    }
  };

  const onCreateSession = async () => {
    if (!datasourceId) {
      setSessionError("请先选择数据源。");
      return;
    }
    setSessionLoading(true);
    setSessionError("");
    try {
      const created = await createSession(datasourceId);
      const latest = await refreshSessionBuckets(datasourceId);
      setSessionId(created.id);
      replaceChatRouteContext({
        datasourceId,
        sessionId: created.id
      });
      resetThreadState([]);
      if (!latest.writable.some((session) => session.id === created.id)) {
        setWritableSessions((previous) => [created, ...previous]);
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
    await refreshSessionBuckets();
  };

  const onDeleteSession = async (targetSessionId: string) => {
    if (!datasourceId) {
      setSessionError("请先选择数据源。");
      return;
    }
    setSessionLoading(true);
    setSessionError("");
    try {
      await deleteSessionRequest(targetSessionId);
      const latest = await refreshSessionBuckets(datasourceId);
      if (targetSessionId !== sessionId) {
        return;
      }
      const nextSessionId = latest.writable[0]?.id;
      if (nextSessionId) {
        setSessionId(nextSessionId);
        replaceChatRouteContext({
          datasourceId,
          sessionId: nextSessionId
        });
        await loadMessages(nextSessionId, datasourceId);
      } else {
        setSessionId("");
        resetThreadState([]);
        replaceChatRouteContext({
          datasourceId
        });
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
      setWritableSessions((previous) =>
        previous.map((session) => (session.id === updated.id ? { ...session, ...updated } : session))
      );
      setReadonlySessions((previous) =>
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
    setRunVisibilityByRunId((previous) => ({
      ...previous,
      [runId]:
        transitionRunVisibilityStatus(previous[runId], "loading") ?? "loading"
    }));
    setRunLoadingById((previous) => ({
      ...previous,
      [runId]: true
    }));
    try {
      const run = normalizeRunForVisibility(await getRun(runId));
      setRunsById((previous) => ({
        ...previous,
        [runId]: run
      }));
      const resolvedStatus = toRunVisibilityStatusFromRunStatus(run.status);
      if (resolvedStatus) {
        setRunVisibilityByRunId((previous) => ({
          ...previous,
          [runId]:
            transitionRunVisibilityStatus(previous[runId], resolvedStatus) ??
            resolvedStatus
        }));
      }
      setStreamDeliveryByRunId((previous) => {
        if (!previous[runId]) {
          return previous;
        }
        const next = { ...previous };
        delete next[runId];
        return next;
      });
    } catch (error) {
      setRunVisibilityByRunId((previous) => ({
        ...previous,
        [runId]:
          transitionRunVisibilityStatus(previous[runId], "error") ?? "error"
      }));
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
          sessions={writableSessions}
          readonlySessions={readonlySessions}
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
            sessions={writableSessions}
            readonlySessions={readonlySessions}
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
                {sessionId
                  ? `Datasource: ${datasourceId || "-"} · Session: ${sessionId}`
                  : datasourceId
                    ? `Datasource: ${datasourceId} · 暂无会话，请先新建会话`
                    : "Session 初始化中..."}
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
                disabled={!canSaveAsView}
                onClick={() => {
                  if (!latestSqlRun?.runId) {
                    return;
                  }
                  setSaveTargetRunId(latestSqlRun.runId);
                  setSaveDialogOpen(true);
                }}
              >
                Save as View
              </Button>
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
          {activeSession?.datasourceStatus && activeSession.datasourceStatus !== "available" ? (
            <StateBlock variant="error">
              当前会话绑定的数据源不可用，历史消息可读，但请先返回数据源页重新选择后再发送。
            </StateBlock>
          ) : null}
          {saveNotice ? <StateBlock variant="success">{saveNotice}</StateBlock> : null}
        </header>

        <AssistantThread
          key={`${sessionId}-${threadVersion}`}
          sessionId={sessionId}
          messages={messages}
          runsById={runsById}
          streamThinkingByRunId={streamThinkingByRunId}
          runLoadingById={runLoadingById}
          streamDeliveryByRunId={streamDeliveryByRunId}
          streamTextStartedByRunId={streamTextStartedByRunId}
          runVisibilityByRunId={runVisibilityByRunId}
          activeStreamRunId={activeStreamRunId}
          thinkingRequestPending={thinkingRequestPending}
          disabled={
            sessionLoading ||
            !sessionId ||
            activeSession?.datasourceStatus === "unavailable" ||
            activeSession?.datasourceStatus === "deleted"
          }
          onRequestRun={ensureRunLoaded}
          onRunStart={() => {
            setActiveStreamRunId(null);
            setThinkingRequestPending(true);
          }}
          onStreamEvent={(event) => {
            if (event.type === "start") {
              setRunVisibilityByRunId((previous) => ({
                ...previous,
                [event.runId]:
                  transitionRunVisibilityStatus(previous[event.runId], "loading") ??
                  "loading"
              }));
              setActiveStreamRunId(event.runId);
              setStreamThinkingByRunId((previous) => ({
                ...previous,
                [event.runId]: []
              }));
              setStreamDeliveryByRunId((previous) => {
                const next = { ...previous };
                delete next[event.runId];
                return next;
              });
              setStreamTextStartedByRunId((previous) => {
                const next = { ...previous };
                delete next[event.runId];
                return next;
              });
              setThinkingRequestPending(true);
              return;
            }
            const projection = projectStreamEvent(event);
            if (projection.textStarted) {
              setStreamTextStartedByRunId((previous) => ({
                ...previous,
                [event.runId]: true
              }));
            }
            if (projection.deliveryPatch) {
              const delivery = normalizeDeliveryContract(projection.deliveryPatch);
              if (delivery) {
                setStreamDeliveryByRunId((previous) => ({
                  ...previous,
                  [event.runId]: delivery
                }));
              }
            }
            if (projection.visibilityStatus) {
              const visibilityStatus = projection.visibilityStatus;
              setRunVisibilityByRunId((previous) => ({
                ...previous,
                [event.runId]:
                  transitionRunVisibilityStatus(
                    previous[event.runId],
                    visibilityStatus
                  ) ?? visibilityStatus
              }));
            }
            const thinkingStep = projection.thinkingStep;
            if (!thinkingStep) {
              if (projection.terminal) {
                setActiveStreamRunId((current) =>
                  current === event.runId ? null : current
                );
                setThinkingRequestPending(false);
              }
              return;
            }
            setStreamThinkingByRunId((previous) =>
              appendThinkingStep(previous, event.runId, thinkingStep)
            );
          }}
          onRunFinish={async (runId) => {
            setActiveStreamRunId((current) => (current === runId ? null : current));
            setThinkingRequestPending(false);
            if (!sessionId) {
              return;
            }
            await loadMessages(sessionId, datasourceId);
            if (runId) {
              await ensureRunLoaded(runId);
            }
            await refreshSessionBuckets();
          }}
          onRunError={async (error) => {
            setActiveStreamRunId(null);
            setThinkingRequestPending(false);
            setSessionError(error.message || "消息发送失败，请稍后重试。");
            if (sessionId) {
              await loadMessages(sessionId, datasourceId).catch(() => undefined);
            }
          }}
        />
        <SaveAsViewDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          workspaceId={saveWorkspaceId}
          datasourceId={datasourceId}
          runId={saveTargetRunId}
          onSaved={(result) => {
            setSaveNotice(
              result.replayed
                ? `View 已存在（${result.view.name}），可直接前往 Modeling。`
                : `已保存 View：${result.view.name}（draft revision=${result.draftRevision}）`
            );
          }}
        />
      </section>
    </div>
  );
}
