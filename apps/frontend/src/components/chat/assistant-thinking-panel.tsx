"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type {
  ExecutionTraceStep,
  ReasoningStage,
  SqlRun
} from "@text2sql/shared-types";
import { BrainCircuit, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { mergeRunThinkingSteps } from "@/components/chat/run-visibility-mapper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";

export interface ThinkingStreamStep extends ExecutionTraceStep {
  stage?: ReasoningStage;
  title?: string;
}

interface AssistantThinkingPanelProps {
  run: SqlRun | null;
  streamSteps: ThinkingStreamStep[];
  inProgress: boolean;
  hasRunReference?: boolean;
  runLoading?: boolean;
  onRequestRun?: () => void;
}

const stageLabels: Record<ReasoningStage, string> = {
  analysis: "问题分析",
  generation: "SQL 生成",
  validation: "安全校验",
  execution: "查询执行",
  response: "回答整理",
  unknown: "处理中"
};

const nodeTitleMap: Record<string, string> = {
  clarify: "理解问题",
  "generate-sql": "生成 SQL",
  "safety-check": "安全校验",
  "execute-sql": "执行查询",
  "format-answer": "整理回答",
  retrieve_knowledge: "知识检索",
  "retrieve-knowledge": "知识检索",
  build_intent_plan: "意图规划",
  "build-intent-plan": "意图规划",
  build_semantic_query: "语义检索构建",
  "build-semantic-query": "语义检索构建"
};

function resolveStepTitle(step: ThinkingStreamStep): string {
  return step.title ?? nodeTitleMap[step.node] ?? step.node;
}

function statusVariant(step: ThinkingStreamStep): "default" | "destructive" | "secondary" {
  if (step.lifecycle === "running") {
    return "secondary";
  }
  if (step.status === "failed") {
    return "destructive";
  }
  if (step.status === "skipped") {
    return "secondary";
  }
  return "default";
}

function statusLabel(step: ThinkingStreamStep): string {
  if (step.lifecycle === "running") {
    return "进行中";
  }
  if (step.status === "failed") {
    return "失败";
  }
  if (step.status === "skipped") {
    return "跳过";
  }
  return "完成";
}

function formatTime(value?: string): string {
  if (!value) {
    return "";
  }
  try {
    return new Date(value).toLocaleTimeString("zh-CN", {
      hour12: false
    });
  } catch {
    return value;
  }
}

export function AssistantThinkingPanel({
  run,
  streamSteps,
  inProgress,
  hasRunReference = false,
  runLoading = false,
  onRequestRun
}: AssistantThinkingPanelProps) {
  const panelContentId = useId();
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);

  const steps = useMemo<ThinkingStreamStep[]>(() => {
    return mergeRunThinkingSteps(run?.trace.steps, streamSteps);
  }, [run, streamSteps]);
  const latestStep = steps.at(-1);
  const activeStep = useMemo(() => {
    const runningStep = [...steps].reverse().find((step) => step.lifecycle === "running");
    return runningStep ?? (inProgress ? latestStep : undefined);
  }, [inProgress, latestStep, steps]);
  const completedCount = steps.filter(
    (step) =>
      step.lifecycle === "completed" ||
      (!step.lifecycle && step.status === "success")
  ).length;
  const hasFailedStep = steps.some(
    (step) => step.lifecycle === "failed" || step.status === "failed"
  );
  const latestStageLabel = latestStep?.stage ? stageLabels[latestStep.stage] : undefined;

  useEffect(() => {
    if (!open || run) {
      setRequested(false);
    }
  }, [open, run]);

  useEffect(() => {
    if (
      open &&
      hasRunReference &&
      !run &&
      !runLoading &&
      !requested &&
      !inProgress &&
      steps.length === 0
    ) {
      setRequested(true);
      onRequestRun?.();
    }
  }, [
    hasRunReference,
    inProgress,
    onRequestRun,
    open,
    requested,
    run,
    runLoading,
    steps.length
  ]);

  if (!inProgress && steps.length === 0 && !hasRunReference) {
    return null;
  }

  return (
    <section className="rounded-xl border border-[var(--chat-result-panel-border)] bg-[var(--chat-result-panel-bg)]">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0 space-y-1">
          <p className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
            <BrainCircuit className="h-3.5 w-3.5 text-[var(--action-primary)]" />
            AI 思考过程
            {inProgress ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--action-primary)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                思考中
              </span>
            ) : null}
          </p>
          {steps.length > 0 ? (
            <div className="space-y-0.5 text-[11px] text-[var(--text-tertiary)]">
              {inProgress && activeStep ? (
                <p className="truncate">
                  活跃步骤：{resolveStepTitle(activeStep)}（{statusLabel(activeStep)}）
                </p>
              ) : null}
              <p className="truncate">
                {latestStageLabel ? `当前阶段：${latestStageLabel} · ` : null}
                已记录 {steps.length} 步
                {inProgress ? `，已完成 ${completedCount}/${steps.length} 步` : null}
                {hasFailedStep ? "（含失败步骤）" : null}
              </p>
            </div>
          ) : hasRunReference ? (
            <p className="truncate text-[11px] text-[var(--text-tertiary)]">
              可展开查看该轮结构化思考摘要
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={panelContentId}
          aria-label={open ? "收起思考过程" : "展开思考过程"}
          className="h-8 min-w-16 px-2 text-xs text-[var(--text-secondary)]"
          onClick={() => setOpen((previous) => !previous)}
        >
          {open ? (
            <>
              收起
              <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              展开
              <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </Button>
      </div>

      {open ? (
        <div
          id={panelContentId}
          className="space-y-2 border-t border-[var(--border-default)] px-3 py-3"
        >
          {steps.length === 0 && runLoading ? (
            <StateBlock variant="idle">正在加载该轮思考轨迹...</StateBlock>
          ) : steps.length === 0 ? (
            <StateBlock variant="idle">
              {inProgress ? "模型正在组织思路，请稍候..." : "暂未加载到该轮思考轨迹。"}
            </StateBlock>
          ) : (
            steps.map((step, index) => (
              <details
                key={
                  step.stepId ??
                  `${step.node}-${step.sequence ?? index}-${step.at ?? step.endedAt ?? index}`
                }
                className="rounded-md border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-2"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {resolveStepTitle(step)}
                    </p>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      {formatTime(step.at || step.endedAt || step.startedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {step.stage ? (
                      <Badge variant="outline" className="border-[var(--border-brand)] text-[var(--action-primary)]">
                        {stageLabels[step.stage]}
                      </Badge>
                    ) : null}
                    {step.durationMs !== undefined ? (
                      <span className="text-xs text-[var(--text-tertiary)]">{step.durationMs}ms</span>
                    ) : null}
                    <Badge variant={statusVariant(step)}>{statusLabel(step)}</Badge>
                  </div>
                </summary>
                <div className="mt-2 space-y-1.5 text-xs text-[var(--text-secondary)]">
                  {step.detail ? <p>Detail: {step.detail}</p> : null}
                  {step.inputSummary ? <p>Input: {step.inputSummary}</p> : null}
                  {step.outputSummary ? <p>Output: {step.outputSummary}</p> : null}
                  {step.errorSummary ? <p>Error: {step.errorSummary}</p> : null}
                </div>
              </details>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
