"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type {
  ExecutionTraceStep,
  ReasoningStage,
  SqlRun
} from "@text2sql/shared-types";
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, Wrench, XCircle } from "lucide-react";
import { mergeRunThinkingSteps } from "@/components/chat/run-visibility-mapper";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { cn } from "@/lib/utils";

export interface ThinkingStreamStep extends ExecutionTraceStep {
  stage?: ReasoningStage;
  title?: string;
  streamKind?: "state" | "tool";
  toolName?: string;
  toolCallId?: string;
  toolStatus?: "called" | "result" | "error";
}

interface AssistantThinkingPanelProps {
  run: SqlRun | null;
  streamSteps: ThinkingStreamStep[];
  inProgress: boolean;
  hasRunReference?: boolean;
  runLoading?: boolean;
  onRequestRun?: () => void;
}

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

function isToolStep(step: ThinkingStreamStep): boolean {
  return step.streamKind === "tool" || step.node.startsWith("tool:");
}

function resolveStepTitle(step: ThinkingStreamStep): string {
  if (isToolStep(step)) {
    return step.toolName ?? step.node.replace(/^tool:/, "");
  }
  return step.title ?? nodeTitleMap[step.node] ?? step.node;
}

function statusLabel(step: ThinkingStreamStep): string {
  if (step.lifecycle === "running") {
    return "进行中";
  }
  if (step.lifecycle === "failed" || step.status === "failed") {
    return "失败";
  }
  if (step.status === "skipped") {
    return "跳过";
  }
  return "完成";
}

function resolveStepSummary(step: ThinkingStreamStep): string | undefined {
  return step.detail ?? step.errorSummary ?? step.outputSummary ?? step.inputSummary;
}

function StepIcon({ step }: { step: ThinkingStreamStep }) {
  if (step.lifecycle === "running") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />;
  }
  if (step.lifecycle === "failed" || step.status === "failed") {
    return <XCircle className="h-3.5 w-3.5" aria-hidden />;
  }
  if (isToolStep(step)) {
    return <Wrench className="h-3.5 w-3.5" aria-hidden />;
  }
  return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />;
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
  const [open, setOpen] = useState(inProgress);
  const [requested, setRequested] = useState(false);

  const steps = useMemo<ThinkingStreamStep[]>(() => {
    return mergeRunThinkingSteps(run?.trace.steps, streamSteps);
  }, [run, streamSteps]);

  useEffect(() => {
    if (!open || run) {
      setRequested(false);
    }
  }, [open, run]);

  useEffect(() => {
    if (inProgress) {
      setOpen(true);
    }
  }, [inProgress]);

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

  const visibleSteps = open ? steps : steps.slice(-1);

  return (
    <section className="mt-1 space-y-1 text-sm text-[var(--text-secondary)]">
      <div className="flex items-center gap-2">
        {inProgress ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" aria-hidden />
            <span>正在思考...</span>
          </span>
        ) : steps.length > 0 ? (
          <span className="text-[var(--text-tertiary)]">处理过程</span>
        ) : (
          <span className="text-[var(--text-tertiary)]">可查看处理过程</span>
        )}

        {steps.length > 0 || hasRunReference ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={panelContentId}
            aria-label={open ? "收起处理过程" : "展开处理过程"}
            className="h-6 rounded-full px-2 text-xs text-[var(--text-tertiary)]"
            onClick={() => setOpen((previous) => !previous)}
          >
            {open ? (
              <>
                收起
                <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                展开
                <ChevronDown className="h-3 w-3" />
              </>
            )}
          </Button>
        ) : null}
      </div>

      <div id={panelContentId} className="space-y-1">
        {steps.length === 0 && runLoading ? (
          <StateBlock variant="idle">正在加载该轮处理轨迹...</StateBlock>
        ) : steps.length === 0 ? (
          inProgress ? (
            <p className="text-xs text-[var(--text-tertiary)]">等待模型返回下一段内容...</p>
          ) : (
            <StateBlock variant="idle">暂未加载到该轮流程轨迹。</StateBlock>
          )
        ) : (
          visibleSteps.map((step, index) => {
            const failed = step.lifecycle === "failed" || step.status === "failed";
            const toolStep = isToolStep(step);
            const summary = resolveStepSummary(step);
            const line = `< | ${toolStep ? "function" : "大模型"} | ${resolveStepTitle(step)}（${statusLabel(step)}）`;
            return (
              <div
                key={
                  step.stepId ??
                  `${step.node}-${step.sequence ?? index}-${step.at ?? step.endedAt ?? index}`
                }
                className="space-y-0.5"
              >
                <p
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    failed ? "text-destructive" : "text-[var(--text-secondary)]"
                  )}
                >
                  <StepIcon step={step} />
                  <span className={toolStep ? "font-mono text-xs" : ""}>{line}</span>
                </p>
                {summary ? (
                  <p className="ml-8 max-w-3xl whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-tertiary)]">
                    {summary}
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
