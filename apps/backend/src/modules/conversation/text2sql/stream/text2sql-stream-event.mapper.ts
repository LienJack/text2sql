import { Injectable } from "@nestjs/common";
import type {
  ChatStreamEventData,
  ChatStreamEventType,
  ExecutionTraceStep,
  SemanticPlanLedgerSummaryV1,
  SqlRun,
  Text2SqlV2RuntimePlanV1,
  Text2SqlV2StageArtifact
} from "@text2sql/shared-types";
import type { LlmGatewayStreamEvent } from "../../../llm/llm-gateway.interface";
import {
  resolveText2SqlV2StageCatalogEntry,
  resolveText2SqlReasoningStage,
  resolveText2SqlTitle
} from "../stages/text2sql-stage-catalog";

interface StepEventInput {
  step: ExecutionTraceStep;
  runId: string;
  lastSequence: number;
}

interface StepEventOutput {
  data: ChatStreamEventData;
  nextSequence: number;
}

interface LlmEventOutput {
  type: ChatStreamEventType;
  data: ChatStreamEventData;
  traceToolCall?: NonNullable<NonNullable<SqlRun["trace"]>["toolCalls"]>[number];
}

@Injectable()
export class Text2SqlStreamEventMapper {
  mapLlmEvent(event: LlmGatewayStreamEvent): LlmEventOutput {
    if (event.type === "text-delta") {
      return {
        type: "text-delta",
        data: {
          text: event.text
        }
      };
    }

    if (event.type === "tool-call") {
      const summary = this.summarizeToolPayload(event.input);
      return {
        type: "tool-call",
        data: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          input: event.input,
          title: `调用 ${event.toolName}`,
          stage: "generation",
          ...(summary ? { summary } : {})
        },
        traceToolCall: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          status: "called",
          detail: JSON.stringify(event.input ?? {}),
          at: new Date().toISOString()
        }
      };
    }

    if (event.type === "tool-result") {
      const summary = this.summarizeToolPayload(event.output);
      return {
        type: "tool-result",
        data: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          output: event.output,
          title: `读取 ${event.toolName} 的结果`,
          stage: "generation",
          ...(summary ? { summary } : {})
        },
        traceToolCall: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          status: "result",
          detail: JSON.stringify(event.output ?? {}),
          at: new Date().toISOString()
        }
      };
    }

    return {
      type: "tool-error",
      data: {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        message: event.message,
        title: `${event.toolName} 调用失败`,
        stage: "generation",
        summary: event.message
      },
      traceToolCall: {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        status: "error",
        detail: event.message,
        at: new Date().toISOString()
      }
    };
  }

  mapStepEvent(input: StepEventInput): StepEventOutput {
    const sequence = input.step.sequence ?? input.lastSequence + 1;
    const stepAt =
      input.step.at ?? input.step.endedAt ?? input.step.startedAt ?? new Date().toISOString();
    const v2StageArtifact = this.extractV2StageArtifact(input.step);
    const v2RuntimePlan = this.extractV2RuntimePlanSummary(input.step);
    const v2PlanLedger = this.extractV2PlanLedgerSummary(input.step);
    const v2CatalogEntry = v2StageArtifact
      ? resolveText2SqlV2StageCatalogEntry(v2StageArtifact.stage)
      : undefined;

    return {
      data: {
        node: input.step.node,
        status: input.step.status,
        stepId: input.step.stepId ?? `${input.runId}:${input.step.node}:${sequence}`,
        sequence,
        lifecycle: input.step.lifecycle ?? this.resolveLifecycle(input.step.status),
        detail: input.step.detail ?? "",
        stage: v2CatalogEntry?.reasoningStage ?? resolveText2SqlReasoningStage(input.step.node),
        title: v2CatalogEntry?.title ?? resolveText2SqlTitle(input.step.node),
        at: stepAt,
        startedAt: input.step.startedAt,
        endedAt: input.step.endedAt,
        durationMs: input.step.durationMs,
        inputSummary: input.step.inputSummary,
        outputSummary: input.step.outputSummary,
        errorSummary: input.step.errorSummary,
        ...(v2StageArtifact
          ? {
              v2: {
                stageArtifact: v2StageArtifact,
                ...(v2RuntimePlan ? { runtimePlan: v2RuntimePlan } : {}),
                ...(v2PlanLedger ? { planLedger: v2PlanLedger } : {})
              }
            }
          : {})
      },
      nextSequence: Math.max(input.lastSequence, sequence)
    };
  }

  private extractV2StageArtifact(
    step: ExecutionTraceStep
  ): Text2SqlV2StageArtifact | undefined {
    const payloads = [step.outputSummary, step.inputSummary]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, 2);

    for (const payload of payloads) {
      const parsed = this.safeParseJson(payload);
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      const v2 = (parsed as { v2?: unknown }).v2;
      if (!v2 || typeof v2 !== "object") {
        continue;
      }
      const candidate = (v2 as { stageArtifact?: unknown }).stageArtifact;
      if (!candidate || typeof candidate !== "object") {
        continue;
      }
      const stage = (candidate as { stage?: unknown }).stage;
      const status = (candidate as { status?: unknown }).status;
      if (typeof stage !== "string" || typeof status !== "string") {
        continue;
      }
      return candidate as Text2SqlV2StageArtifact;
    }

    return undefined;
  }

  private extractV2RuntimePlanSummary(
    step: ExecutionTraceStep
  ): NonNullable<
    Extract<ChatStreamEventData, { node: string }>["v2"]
  >["runtimePlan"] | undefined {
    const runtimePlan = this.extractV2RuntimePlan(step);
    const current =
      runtimePlan?.items.find((item) => item.id === runtimePlan.currentItemId) ??
      runtimePlan?.items.at(-1);
    if (!runtimePlan || !current) {
      return undefined;
    }
    return {
      ...(runtimePlan.currentItemId
        ? { currentItemId: runtimePlan.currentItemId }
        : {}),
      stage: current.stage,
      status: current.status,
      summary: current.summary ?? runtimePlan.summary,
      ...(current.reasonCodes?.length ? { reasonCodes: current.reasonCodes } : {})
    };
  }

  private extractV2RuntimePlan(
    step: ExecutionTraceStep
  ): Text2SqlV2RuntimePlanV1 | undefined {
    const payloads = [step.outputSummary, step.inputSummary]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, 2);

    for (const payload of payloads) {
      const parsed = this.safeParseJson(payload);
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      const v2 = (parsed as { v2?: unknown }).v2;
      if (!v2 || typeof v2 !== "object") {
        continue;
      }
      const candidate = (v2 as { runtimePlan?: unknown }).runtimePlan;
      if (!candidate || typeof candidate !== "object") {
        continue;
      }
      const items = (candidate as { items?: unknown }).items;
      if (!Array.isArray(items) || items.length === 0) {
        continue;
      }
      return candidate as Text2SqlV2RuntimePlanV1;
    }

    return undefined;
  }

  private extractV2PlanLedgerSummary(
    step: ExecutionTraceStep
  ): SemanticPlanLedgerSummaryV1 | undefined {
    const payloads = [step.outputSummary, step.inputSummary]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, 2);

    for (const payload of payloads) {
      const parsed = this.safeParseJson(payload);
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      const v2 = (parsed as { v2?: unknown }).v2;
      if (!v2 || typeof v2 !== "object") {
        continue;
      }
      const candidate =
        (v2 as { planLedger?: unknown }).planLedger ??
        (v2 as { sqlValidation?: { ledgerFulfillment?: unknown } }).sqlValidation?.ledgerFulfillment ??
        (v2 as { semanticPlan?: { planLedger?: { summary?: unknown } } }).semanticPlan?.planLedger?.summary;
      if (!candidate || typeof candidate !== "object") {
        continue;
      }
      const total = (candidate as { total?: unknown }).total;
      const hardBlockerCount = (candidate as { hardBlockerCount?: unknown }).hardBlockerCount;
      const warningCount = (candidate as { warningCount?: unknown }).warningCount;
      if (
        typeof total !== "number" ||
        typeof hardBlockerCount !== "number" ||
        typeof warningCount !== "number"
      ) {
        continue;
      }
      return candidate as SemanticPlanLedgerSummaryV1;
    }

    return undefined;
  }

  private safeParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private summarizeToolPayload(payload: unknown): string | undefined {
    if (payload === undefined || payload === null) {
      return undefined;
    }
    if (typeof payload === "string") {
      return this.truncate(payload);
    }
    if (typeof payload !== "object") {
      return this.truncate(String(payload));
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.sql === "string" && record.sql.trim()) {
      return this.truncate(record.sql);
    }
    if (typeof record.rowCount === "number") {
      return `返回 ${record.rowCount} 行`;
    }
    if (Array.isArray(record.rows)) {
      return `返回 ${record.rows.length} 行`;
    }
    try {
      return this.truncate(JSON.stringify(payload));
    } catch {
      return undefined;
    }
  }

  private truncate(value: string, maxLength = 180): string {
    const normalized = value.trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength - 1)}…`;
  }

  private resolveLifecycle(
    status: ExecutionTraceStep["status"]
  ): "completed" | "failed" | "skipped" {
    if (status === "failed") {
      return "failed";
    }
    if (status === "skipped") {
      return "skipped";
    }
    return "completed";
  }
}
