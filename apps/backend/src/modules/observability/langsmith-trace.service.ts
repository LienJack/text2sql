import { Injectable, Logger } from "@nestjs/common";
import { Client, RunTree } from "langsmith";
import { AppConfigService } from "../config/app-config.service";
import type {
  LangsmithRootContext,
  LangsmithRootHandle,
  LangsmithRootResult,
  LangsmithSpanPayload,
  LangsmithTracingStatus
} from "./langsmith.types";

@Injectable()
export class LangsmithTraceService {
  private readonly logger = new Logger(LangsmithTraceService.name);
  private readonly client?: Client;

  constructor(private readonly config: AppConfigService) {
    if (this.config.langsmithReady) {
      this.client = new Client({
        apiKey: this.config.langsmithApiKey,
        apiUrl: this.config.langsmithEndpoint,
        timeout_ms: this.config.langsmithTimeoutMs,
        workspaceId: this.config.langsmithWorkspaceId || undefined
      });
      return;
    }
    if (this.config.langsmithTracing) {
      this.logger.warn(
        "LANGSMITH_TRACING=true but LangSmith credentials are incomplete, fallback mode enabled."
      );
    }
  }

  getStatus(): LangsmithTracingStatus {
    return {
      tracingRequested: this.config.langsmithTracing,
      configured: this.config.langsmithConfigured,
      ready: this.config.langsmithReady,
      project: this.config.langsmithProject,
      endpoint: this.config.langsmithEndpoint
    };
  }

  startRoot(context: LangsmithRootContext): LangsmithRootHandle {
    const handle: LangsmithRootHandle = {
      runId: context.runId,
      source: context.source,
      queue: Promise.resolve()
    };
    if (!this.client) {
      return handle;
    }

    const root = new RunTree({
      id: context.runId,
      trace_id: context.runId,
      name: context.source === "chat" ? "chat-message-run" : "evaluation-case-run",
      run_type: "chain",
      project_name: this.config.langsmithProject,
      client: this.client,
      inputs: this.compact({
        question: context.question,
        sessionId: context.sessionId
      }),
      metadata: this.compact({
        runId: context.runId,
        sessionId: context.sessionId,
        source: context.source,
        route: context.route,
        requestId: context.requestId,
        jobId: context.jobId,
        caseId: context.caseId
      }),
      tags: [`source:${context.source}`, `route:${context.route}`]
    });
    handle.root = root;
    this.enqueue(handle, async () => {
      await root.postRun();
    }, {
      phase: "root_start",
      runId: context.runId,
      route: context.route
    });
    return handle;
  }

  recordSpan(handle: LangsmithRootHandle, payload: LangsmithSpanPayload): void {
    if (!handle.root) {
      return;
    }
    this.enqueue(
      handle,
      async () => {
        const child = handle.root?.createChild({
          name: payload.node,
          run_type: payload.runType ?? this.inferRunType(payload.node),
          project_name: this.config.langsmithProject,
          inputs: this.compact({
            detail: payload.detail,
            ...payload.inputs
          }),
          metadata: this.compact({
            status: payload.status,
            ...payload.metadata
          }),
          tags: [`node:${payload.node}`, `status:${payload.status}`]
        });
        if (!child) {
          return;
        }
        await child.postRun();
        if (payload.status === "failed") {
          await child.end(
            this.compact(payload.outputs),
            payload.error ?? payload.detail ?? "node failed"
          );
        } else {
          await child.end(
            this.compact({
              status: payload.status,
              detail: payload.detail,
              ...payload.outputs
            })
          );
        }
        await child.patchRun();
      },
      {
        phase: "span",
        runId: handle.runId,
        node: payload.node,
        status: payload.status
      }
    );
  }

  endRoot(handle: LangsmithRootHandle, result: LangsmithRootResult): void {
    if (!handle.root) {
      return;
    }
    this.enqueue(
      handle,
      async () => {
        if (result.error) {
          await handle.root?.end(
            this.compact({
              status: result.status,
              provider: result.provider,
              ...result.outputs
            }),
            result.error,
            undefined,
            this.compact(result.metadata)
          );
        } else {
          await handle.root?.end(
            this.compact({
              status: result.status,
              provider: result.provider,
              ...result.outputs
            }),
            undefined,
            undefined,
            this.compact(result.metadata)
          );
        }
        await handle.root?.patchRun();
      },
      {
        phase: "root_end",
        runId: handle.runId,
        status: result.status
      }
    );
  }

  private enqueue(
    handle: LangsmithRootHandle,
    operation: () => Promise<void>,
    fallbackContext: Record<string, unknown>
  ): void {
    handle.queue = handle.queue
      .then(operation)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          JSON.stringify({
            event: "langsmith_fallback",
            message,
            ...fallbackContext
          })
        );
      });
  }

  private compact(payload?: Record<string, unknown>): Record<string, unknown> {
    if (!payload) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    );
  }

  private inferRunType(node: string): "chain" | "llm" | "tool" {
    if (node === "generate-sql") {
      return "llm";
    }
    if (node === "graph") {
      return "chain";
    }
    return "tool";
  }
}
