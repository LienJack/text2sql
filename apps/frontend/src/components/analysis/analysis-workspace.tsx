"use client";

import type {
  AnalysisGoalContract,
  AnalysisTaskReadModel,
  AnalysisTaskRecord
} from "@text2sql/shared-types";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { BookOpenCheck, FileWarning, PanelTop, RefreshCw, Target } from "lucide-react";
import { AnalysisConflictPanel } from "@/components/analysis/analysis-conflict-panel";
import { AnalysisEvidencePanel } from "@/components/analysis/analysis-evidence-panel";
import { AnalysisGoalComposer } from "@/components/analysis/analysis-goal-composer";
import { AnalysisPlanPanel } from "@/components/analysis/analysis-plan-panel";
import { AnalysisProgressPanel } from "@/components/analysis/analysis-progress-panel";
import { AnalysisReportPanel } from "@/components/analysis/analysis-report-panel";
import { AnalysisTaskControls } from "@/components/analysis/analysis-task-controls";
import {
  AnalysisTaskList,
  analysisStatusLabel
} from "@/components/analysis/analysis-task-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  analysisTaskReducer,
  commandAnalysisTask,
  createAnalysisTask,
  getAnalysisTask,
  initialAnalysisTaskUiState,
  isAnalysisTerminal,
  listAnalysisTasks,
  resolveAnalysisWorkspaceId,
  runNextAnalysisWork,
  streamAnalysisTaskEvents
} from "@/lib/analysis-api-client";

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));

export function AnalysisWorkspace() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [tasks, setTasks] = useState<AnalysisTaskRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [state, dispatch] = useReducer(
    analysisTaskReducer,
    initialAnalysisTaskUiState
  );

  const refreshList = useCallback(async (resolvedWorkspaceId: string) => {
    const nextTasks = await listAnalysisTasks(resolvedWorkspaceId);
    setTasks(nextTasks);
    setSelectedTaskId((current) =>
      current && nextTasks.some((task) => task.id === current)
        ? current
        : (nextTasks[0]?.id ?? "")
    );
    return nextTasks;
  }, []);

  const refreshTask = useCallback(
    async (taskId: string): Promise<AnalysisTaskReadModel> => {
      const model = await getAnalysisTask(taskId, workspaceId);
      dispatch({ type: "hydrate", readModel: model });
      return model;
    },
    [workspaceId]
  );

  useEffect(() => {
    let disposed = false;
    const activateWorkspace = (resolvedWorkspaceId: string) => {
      if (!resolvedWorkspaceId) return;
      setWorkspaceId(resolvedWorkspaceId);
      setLoading(true);
      void refreshList(resolvedWorkspaceId)
        .catch((error) => {
          if (!disposed) {
            dispatch({
              type: "error",
              error: error instanceof Error ? error.message : "加载分析任务失败"
            });
          }
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    };
    const onWorkspaceChange = (event: Event) => {
      const workspaceEvent = event as CustomEvent<{ workspaceId?: string }>;
      activateWorkspace(workspaceEvent.detail?.workspaceId?.trim() ?? "");
    };
    window.addEventListener("text2sql:workspace-change", onWorkspaceChange);
    activateWorkspace(resolveAnalysisWorkspaceId());
    return () => {
      disposed = true;
      window.removeEventListener("text2sql:workspace-change", onWorkspaceChange);
    };
  }, [refreshList]);

  useEffect(() => {
    if (!selectedTaskId || !workspaceId) {
      dispatch({ type: "reset" });
      return;
    }
    let stopped = false;
    const controller = new AbortController();
    let cursor = 0;
    void (async () => {
      try {
        const initial = await refreshTask(selectedTaskId);
        cursor = Math.max(0, ...initial.events.map((event) => event.sequence));
        if (isAnalysisTerminal(initial.task.status)) {
          dispatch({ type: "connection", connection: "closed" });
          return;
        }
        let attempt = 0;
        while (!stopped) {
          dispatch({
            type: "connection",
            connection: attempt === 0 ? "connecting" : "reconnecting"
          });
          try {
            dispatch({ type: "connection", connection: "live" });
            await streamAnalysisTaskEvents({
              taskId: selectedTaskId,
              workspaceId,
              cursor,
              signal: controller.signal,
              onEvent: (event) => {
                cursor = Math.max(cursor, event.sequence);
                dispatch({ type: "merge_events", events: [event] });
              }
            });
            if (stopped) return;
            const model = await refreshTask(selectedTaskId);
            if (isAnalysisTerminal(model.task.status)) {
              dispatch({ type: "connection", connection: "closed" });
              return;
            }
          } catch (error) {
            if (controller.signal.aborted || stopped) return;
            dispatch({
              type: "error",
              error: error instanceof Error ? error.message : "事件流连接失败"
            });
          }
          attempt += 1;
          await wait(Math.min(5_000, 500 * 2 ** Math.min(attempt, 3)));
        }
      } catch (error) {
        if (!stopped) {
          dispatch({
            type: "error",
            error: error instanceof Error ? error.message : "加载任务详情失败"
          });
        }
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [refreshTask, selectedTaskId, workspaceId]);

  useEffect(() => {
    if (!selectedTaskId || !workspaceId || isAnalysisTerminal(state.readModel?.task.status ?? "draft")) {
      return;
    }
    const timer = window.setInterval(() => {
      void Promise.all([refreshTask(selectedTaskId), refreshList(workspaceId)]).catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [refreshList, refreshTask, selectedTaskId, state.readModel?.task.status, workspaceId]);

  const activeArtifacts = useMemo(
    () =>
      state.readModel?.artifacts.filter(
        (artifact) => artifact.revisionId === state.readModel?.currentRevision.id
      ) ?? [],
    [state.readModel]
  );

  const createTask = async (goal: AnalysisGoalContract) => {
    setBusy(true);
    try {
      const model = await createAnalysisTask(goal);
      dispatch({ type: "hydrate", readModel: model });
      await refreshList(goal.workspaceId);
      setSelectedTaskId(model.task.id);
      setShowComposer(false);
    } catch (error) {
      dispatch({ type: "error", error: error instanceof Error ? error.message : "创建任务失败" });
    } finally {
      setBusy(false);
    }
  };

  const runCommand = async (type: "start" | "pause" | "resume" | "cancel") => {
    if (!state.readModel) return;
    setBusy(true);
    try {
      await commandAnalysisTask({ task: state.readModel.task, type });
      await Promise.all([refreshTask(state.readModel.task.id), refreshList(workspaceId)]);
    } catch (error) {
      dispatch({ type: "error", error: error instanceof Error ? error.message : "任务命令失败" });
    } finally {
      setBusy(false);
    }
  };

  const runNext = async () => {
    if (!state.readModel) return;
    setBusy(true);
    try {
      await runNextAnalysisWork(state.readModel.task.id, workspaceId);
      await Promise.all([refreshTask(state.readModel.task.id), refreshList(workspaceId)]);
    } catch (error) {
      dispatch({ type: "error", error: error instanceof Error ? error.message : "推进 WorkGraph 失败" });
    } finally {
      setBusy(false);
    }
  };

  if (showComposer) {
    return <AnalysisGoalComposer workspaceId={workspaceId} busy={busy} onCancel={() => setShowComposer(false)} onCreate={createTask} />;
  }

  return (
    <div className="min-h-full bg-[#ede8dc] text-stone-900">
      <div className="grid min-h-full lg:grid-cols-[260px_minmax(0,1fr)]">
        <AnalysisTaskList tasks={tasks} selectedTaskId={selectedTaskId} onSelect={setSelectedTaskId} onCreate={() => setShowComposer(true)} />
        <section className="min-w-0">
          {loading ? <div className="p-6"><StateBlock variant="loading">正在读取 Analysis Ledger…</StateBlock></div> : null}
          {state.error ? (
            <div className="m-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <span className="flex items-center gap-2"><FileWarning className="size-4 shrink-0" />{state.error}</span>
              {selectedTaskId ? <Button size="sm" variant="outline" onClick={() => void refreshTask(selectedTaskId)}><RefreshCw />重试</Button> : null}
            </div>
          ) : null}
          {!loading && !state.readModel ? (
            <div className="flex min-h-[560px] items-center justify-center p-6">
              <div className="max-w-md text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-900"><Target className="size-5" /></div>
                <h2 className="mt-5 font-serif text-2xl font-semibold">从一个明确的决策问题开始</h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">自治分析会把目标编译成可回放的 WorkGraph，并对证据、计算、冲突和报告保留完整谱系。</p>
                <Button className="mt-5" onClick={() => setShowComposer(true)}>新建分析任务</Button>
              </div>
            </div>
          ) : null}
          {state.readModel ? (
            <div className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_320px]">
              <main className="min-w-0 bg-[#fffdf7]">
                <header className="border-b border-stone-200 px-4 py-5 sm:px-6">
                  <div className="flex flex-col justify-between gap-4 2xl:flex-row 2xl:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-900">{analysisStatusLabel(state.readModel.task.status)}</Badge>
                        <span className="font-mono text-[11px] text-stone-500">{state.readModel.task.id}</span>
                      </div>
                      <h2 className="mt-3 max-w-3xl font-serif text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl">{state.readModel.currentRevision.goalContract.objective}</h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">决策用途：{state.readModel.currentRevision.goalContract.decisionUse}</p>
                    </div>
                    <AnalysisTaskControls task={state.readModel.task} connection={state.connection} busy={busy} onCommand={runCommand} onRunNext={runNext} />
                  </div>
                </header>
                <AnalysisProgressPanel model={state.readModel} />
                <Tabs defaultValue="evidence" className="p-4 sm:p-6">
                  <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b border-stone-200 pb-1">
                    <TabsTrigger value="evidence"><BookOpenCheck />证据</TabsTrigger>
                    <TabsTrigger value="conflicts"><FileWarning />冲突</TabsTrigger>
                    <TabsTrigger value="report"><PanelTop />报告</TabsTrigger>
                  </TabsList>
                  <TabsContent value="evidence" className="pt-5"><AnalysisEvidencePanel artifacts={activeArtifacts} /></TabsContent>
                  <TabsContent value="conflicts" className="pt-5"><AnalysisConflictPanel model={state.readModel} /></TabsContent>
                  <TabsContent value="report" className="pt-5"><AnalysisReportPanel model={state.readModel} /></TabsContent>
                </Tabs>
              </main>
              <aside className="border-t border-stone-200 bg-[#f6f2e8] xl:border-t-0 xl:border-l">
                <AnalysisPlanPanel model={state.readModel} />
                <div className="p-4">
                  <p className="text-xs font-semibold tracking-wide text-stone-600 uppercase">边界与停止条件</p>
                  <ul className="mt-3 space-y-2 text-xs leading-5 text-stone-600">
                    {state.readModel.currentRevision.goalContract.stopConditions.map((condition) => <li key={condition} className="border-l border-stone-300 pl-3">{condition}</li>)}
                  </ul>
                </div>
              </aside>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
