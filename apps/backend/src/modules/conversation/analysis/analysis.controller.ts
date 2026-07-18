import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import {
  isAnalysisTaskTerminalStatus,
  serializeAnalysisEventSse,
  type AnalysisGoalContract,
  type AnalysisTaskCommandType
} from "@text2sql/analysis-task-protocol";
import type { ApiResponse } from "@text2sql/shared-types";
import type { Request, Response } from "express";
import { fail, ok } from "../../../common/api-response";
import { DomainError } from "../../../common/domain-error";
import { AppConfigService } from "../../config/app-config.service";
import { PrincipalContextGuard } from "../../governance/auth/principal-context.guard";
import { AnalysisTaskCommandService } from "./application/analysis-task-command.service";
import { AnalysisTaskReplayService } from "./application/analysis-task-replay.service";
import { AnalysisTaskService } from "./application/analysis-task.service";
import { AnalysisOrchestratorService } from "./orchestration/analysis-orchestrator.service";

type CreateTaskBody = {
  goalContract: AnalysisGoalContract;
  idempotencyKey?: string;
  retentionExpiresAt?: string;
};

type ReviseTaskBody = {
  commandId: string;
  expectedTaskVersion: number;
  goalContract: AnalysisGoalContract;
};

type LifecycleCommandBody = {
  commandId: string;
  type: Exclude<AnalysisTaskCommandType, "revise">;
  expectedTaskVersion: number;
  expectedAuthorityEpoch: number;
  payload?: Record<string, unknown>;
};

const lifecycleCommands = new Set<LifecycleCommandBody["type"]>([
  "start",
  "decide",
  "pause",
  "resume",
  "cancel"
]);

@Controller("/api/v1/analysis")
@UseGuards(PrincipalContextGuard)
export class AnalysisController {
  constructor(
    private readonly tasks: AnalysisTaskService,
    private readonly commands: AnalysisTaskCommandService,
    private readonly replayService: AnalysisTaskReplayService,
    private readonly orchestrator: AnalysisOrchestratorService,
    private readonly config: AppConfigService
  ) {}

  @Post("/tasks")
  async createTask(
    @Body() body: CreateTaskBody,
    @Headers("x-idempotency-key") headerIdempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const task = await this.tasks.create({
        actor: req.actor,
        goalContract: body.goalContract,
        idempotencyKey: body.idempotencyKey ?? headerIdempotencyKey ?? "",
        retentionExpiresAt: body.retentionExpiresAt
      });
      res.status(201);
      return ok(req.requestId, task);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Post("/tasks/:taskId/work/next")
  async runNextWork(
    @Param("taskId") taskId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      return ok(req.requestId, await this.orchestrator.runNext(req.actor, taskId));
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Get("/tasks")
  async listTasks(
    @Query("workspaceId") workspaceId: string,
    @Query("limit") limitRaw: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const tasks = await this.tasks.list({
        actor: req.actor,
        workspaceId,
        limit: this.optionalPositiveInteger(limitRaw, "limit")
      });
      return ok(req.requestId, tasks);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Get("/tasks/:taskId")
  async getTask(
    @Param("taskId") taskId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      return ok(req.requestId, await this.tasks.get(req.actor, taskId));
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Post("/tasks/:taskId/revisions")
  async reviseTask(
    @Param("taskId") taskId: string,
    @Body() body: ReviseTaskBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      this.requirePositiveInteger(body.expectedTaskVersion, "expectedTaskVersion");
      const existing = await this.commands.findExistingRevisionAcceptance({
        actor: req.actor,
        taskId,
        commandId: body.commandId,
        goalContract: body.goalContract
      });
      if (existing) {
        return ok(req.requestId, {
          acceptance: existing,
          task: await this.tasks.get(req.actor, taskId)
        });
      }
      const revised = await this.tasks.revise({
        actor: req.actor,
        taskId,
        expectedTaskVersion: body.expectedTaskVersion,
        goalContract: body.goalContract
      });
      const acceptance = await this.commands.acceptRevision({
        actor: req.actor,
        taskId,
        commandId: body.commandId,
        expectedTaskVersion: revised.task.version,
        expectedAuthorityEpoch: revised.task.authorityEpoch
      });
      return ok(req.requestId, {
        acceptance,
        task: await this.tasks.get(req.actor, taskId)
      });
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Post("/tasks/:taskId/commands")
  async commandTask(
    @Param("taskId") taskId: string,
    @Body() body: LifecycleCommandBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      if (!lifecycleCommands.has(body.type)) {
        throw new DomainError(
          "ANALYSIS_COMMAND_INVALID",
          "仅支持 start、decide、pause、resume、cancel；revise 使用 revisions API。",
          400
        );
      }
      this.requirePositiveInteger(body.expectedTaskVersion, "expectedTaskVersion");
      this.requirePositiveInteger(
        body.expectedAuthorityEpoch,
        "expectedAuthorityEpoch"
      );
      const acceptance = await this.commands.accept({
        actor: req.actor,
        taskId,
        commandId: body.commandId,
        type: body.type,
        expectedTaskVersion: body.expectedTaskVersion,
        expectedAuthorityEpoch: body.expectedAuthorityEpoch,
        payload: body.payload
      });
      res.status(202);
      return ok(req.requestId, { acceptance });
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Get("/tasks/:taskId/events")
  async listEvents(
    @Param("taskId") taskId: string,
    @Query("after") afterRaw: string | undefined,
    @Query("limit") limitRaw: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const events = await this.tasks.events({
        actor: req.actor,
        taskId,
        afterSequence: this.optionalNonNegativeInteger(afterRaw, "after"),
        limit: this.optionalPositiveInteger(limitRaw, "limit")
      });
      return ok(req.requestId, events);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Get("/tasks/:taskId/events/stream")
  async streamEvents(
    @Param("taskId") taskId: string,
    @Query("cursor") cursorRaw: string | undefined,
    @Headers("last-event-id") lastEventId: string | undefined,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    try {
      await this.tasks.requireAuthorizedTask(req.actor, taskId);
    } catch (error) {
      this.toError(req.requestId, error, res);
      return;
    }
    let closed = false;
    const close = () => {
      closed = true;
    };
    req.on("aborted", close);
    req.on("close", close);
    res.on("close", close);
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let cursor =
      this.optionalNonNegativeInteger(cursorRaw ?? lastEventId, "cursor") ?? 0;
    let heartbeatAt = Date.now();
    try {
      while (!closed && !res.writableEnded) {
        const events = await this.tasks.events({
          actor: req.actor,
          taskId,
          afterSequence: cursor,
          limit: 500
        });
        for (const event of events) {
          if (closed || res.writableEnded) {
            break;
          }
          res.write(serializeAnalysisEventSse(event));
          cursor = event.sequence;
        }
        const current = await this.tasks.requireAuthorizedTask(req.actor, taskId);
        if (isAnalysisTaskTerminalStatus(current.status) && events.length === 0) {
          break;
        }
        if (Date.now() - heartbeatAt >= 15_000) {
          res.write(": keepalive\n\n");
          heartbeatAt = Date.now();
        }
        await this.waitForNextPoll(() => closed || res.writableEnded);
      }
    } catch (error) {
      if (!closed && !res.writableEnded) {
        const code = error instanceof DomainError ? error.code : "INTERNAL_ERROR";
        res.write(`event: error\ndata: ${JSON.stringify({ code })}\n\n`);
      }
    } finally {
      req.off("aborted", close);
      req.off("close", close);
      res.off("close", close);
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  @Get("/tasks/:taskId/replay")
  async replay(
    @Param("taskId") taskId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      return ok(
        req.requestId,
        await this.replayService.replay(req.actor, taskId)
      );
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  private async waitForNextPoll(isClosed: () => boolean): Promise<void> {
    if (isClosed()) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.config.analysisEventPollIntervalMs);
      timer.unref?.();
    });
  }

  private optionalPositiveInteger(
    value: string | undefined,
    field: string
  ): number | undefined {
    if (value === undefined || value === "") {
      return undefined;
    }
    const parsed = Number(value);
    this.requirePositiveInteger(parsed, field);
    return parsed;
  }

  private optionalNonNegativeInteger(
    value: string | undefined,
    field: string
  ): number | undefined {
    if (value === undefined || value === "") {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new DomainError("VALIDATION_ERROR", `${field} 必须为非负整数。`, 400);
    }
    return parsed;
  }

  private requirePositiveInteger(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new DomainError("VALIDATION_ERROR", `${field} 必须为正整数。`, 400);
    }
  }

  private toError(
    requestId: string,
    error: unknown,
    res: Response
  ): ApiResponse<never> {
    if (error instanceof DomainError) {
      res.status(error.statusCode);
      return fail(requestId, error.code, error.message, error.details);
    }
    res.status(500);
    return fail(
      requestId,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "未知错误"
    );
  }
}
