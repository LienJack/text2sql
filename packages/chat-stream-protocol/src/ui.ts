import type {
  ChatStreamEvent,
  DeliveryContract,
  ExecutionTraceStep,
  ReasoningStage,
  RunStatus
} from "@text2sql/shared-types";

export type RunVisibilityStatus = "loading" | "success" | "error" | "empty" | "cancelled";

export type RunVisibilityThinkingStep = ExecutionTraceStep & {
  stage?: ReasoningStage;
  title?: string;
  streamKind?: "state" | "tool";
  toolName?: string;
  toolCallId?: string;
  toolStatus?: "called" | "result" | "error";
};

export interface StreamEventProjection {
  thinkingStep: RunVisibilityThinkingStep | null;
  textStarted: boolean;
  terminal: boolean;
  visibilityStatus?: RunVisibilityStatus;
  deliveryPatch?: unknown;
}

function summarizeToolPayload(payload: unknown): string {
  if (payload === undefined || payload === null) {
    return "";
  }
  if (typeof payload === "string") {
    return payload.slice(0, 180);
  }
  if (typeof payload !== "object") {
    return String(payload).slice(0, 180);
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.sql === "string") {
    return record.sql.slice(0, 180);
  }
  if (typeof record.rowCount === "number") {
    return `返回 ${record.rowCount} 行`;
  }
  try {
    return JSON.stringify(payload).slice(0, 180);
  } catch {
    return "";
  }
}

export function toThinkingStepFromStreamEvent(
  event: ChatStreamEvent
): RunVisibilityThinkingStep | null {
  if (event.type === "tool-call") {
    const payload = event.data as
      | {
          toolName?: string;
          toolCallId?: string;
          input?: unknown;
          title?: string;
          stage?: ReasoningStage;
          summary?: string;
        }
      | undefined;
    const toolName = payload?.toolName ?? "tool";
    return {
      node: `tool:${toolName}`,
      status: "success",
      stepId: `${event.runId}:tool:${payload?.toolCallId ?? event.at}`,
      lifecycle: "running",
      detail: payload?.summary ?? summarizeToolPayload(payload?.input),
      at: event.at,
      startedAt: event.at,
      stage: payload?.stage ?? "generation",
      title: payload?.title ?? `调用工具：${toolName}`,
      streamKind: "tool",
      toolName,
      toolCallId: payload?.toolCallId,
      toolStatus: "called"
    };
  }
  if (event.type === "tool-result") {
    const payload = event.data as
      | {
          toolName?: string;
          toolCallId?: string;
          output?: unknown;
          title?: string;
          stage?: ReasoningStage;
          summary?: string;
        }
      | undefined;
    const toolName = payload?.toolName ?? "tool";
    return {
      node: `tool:${toolName}`,
      status: "success",
      stepId: `${event.runId}:tool:${payload?.toolCallId ?? event.at}`,
      lifecycle: "completed",
      detail: payload?.summary ?? summarizeToolPayload(payload?.output),
      at: event.at,
      endedAt: event.at,
      stage: payload?.stage ?? "generation",
      title: payload?.title ?? `工具返回：${toolName}`,
      streamKind: "tool",
      toolName,
      toolCallId: payload?.toolCallId,
      toolStatus: "result"
    };
  }
  if (event.type === "tool-error") {
    const payload = event.data as
      | {
          toolName?: string;
          toolCallId?: string;
          message?: string;
          title?: string;
          stage?: ReasoningStage;
          summary?: string;
        }
      | undefined;
    const toolName = payload?.toolName ?? "tool";
    return {
      node: `tool:${toolName}`,
      status: "failed",
      stepId: `${event.runId}:tool:${payload?.toolCallId ?? event.at}`,
      lifecycle: "failed",
      detail: payload?.summary ?? payload?.message ?? "工具调用失败",
      errorSummary: payload?.message,
      at: event.at,
      endedAt: event.at,
      stage: payload?.stage ?? "generation",
      title: payload?.title ?? `工具失败：${toolName}`,
      streamKind: "tool",
      toolName,
      toolCallId: payload?.toolCallId,
      toolStatus: "error"
    };
  }
  if (event.type !== "state") {
    return null;
  }
  const payload = event.data as
    | {
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
    | undefined;
  if (!payload) {
    return null;
  }
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
    title: payload.title,
    streamKind: "state"
  };
}

export function toRunVisibilityStatusFromRunStatus(
  status: RunStatus | undefined
): RunVisibilityStatus | undefined {
  if (!status) {
    return undefined;
  }
  if (status === "failed" || status === "rejected") {
    return "error";
  }
  if (status === "clarification") {
    return "empty";
  }
  return "success";
}

export function transitionRunVisibilityStatus(
  previous: RunVisibilityStatus | undefined,
  next: RunVisibilityStatus | undefined
): RunVisibilityStatus | undefined {
  if (!next) {
    return previous;
  }
  if (
    (previous === "success" ||
      previous === "error" ||
      previous === "empty" ||
      previous === "cancelled") &&
    next === "loading"
  ) {
    return previous;
  }
  return next;
}

export function projectStreamEvent(event: ChatStreamEvent): StreamEventProjection {
  const thinkingStep = toThinkingStepFromStreamEvent(event);
  const text =
    event.type === "text-delta"
      ? (event.data as { text?: unknown } | undefined)?.text
      : undefined;

  if (event.type === "finish") {
    const finishData = event.data as
      | { delivery?: DeliveryContract; status?: RunStatus }
      | undefined;
    return {
      thinkingStep,
      textStarted: false,
      terminal: true,
      deliveryPatch: finishData?.delivery,
      visibilityStatus: toRunVisibilityStatusFromRunStatus(
        typeof finishData?.status === "string" ? finishData.status : "executionResult"
      )
    };
  }

  if (event.type === "error") {
    const payload = event.data as { code?: string } | undefined;
    return {
      thinkingStep,
      textStarted: false,
      terminal: true,
      visibilityStatus: payload?.code === "USER_CANCELLED" ? "cancelled" : "error"
    };
  }

  return {
    thinkingStep,
    textStarted: typeof text === "string" && text.length > 0,
    terminal: false
  };
}
