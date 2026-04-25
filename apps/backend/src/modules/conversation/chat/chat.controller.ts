import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Query,
  Req,
  Res,
  UsePipes,
  ValidationPipe
} from "@nestjs/common";
import type { Request, Response } from "express";
import type {
  AgentRunResponse,
  ApiResponse,
  ChatStreamEvent
} from "@text2sql/shared-types";
import { fail, ok } from "../../../common/api-response";
import { DomainError } from "../../../common/domain-error";
import { CreateSessionDto } from "./dto/create-session.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { RenameSessionDto } from "./dto/rename-session.dto";
import { SaveViewFromRunDto } from "./dto/save-view-from-run.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { ChatService } from "./chat.service";

@Controller("/api/v1")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post("/sessions")
  async createSession(
    @Body() body: CreateSessionDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const datasource = body.datasource?.trim();
      if (!datasource) {
        throw new DomainError("VALIDATION_ERROR", "datasource 为必填项", 400, {
          field: "datasource"
        });
      }
      const workspaceId = body.workspaceId?.trim() || this.resolveWorkspaceId(req);
      const session = await this.chatService.createSession(
        datasource,
        body.modelCatalogId,
        {
          workspaceId,
          createdByUserId: req.actor?.id,
          actor: req.actor
        }
      );
      return ok(req.requestId, session);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Get("/sessions")
  async listSessions(
    @Query() query: ListSessionsDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const sessions = await this.chatService.listSessions(
        query.status,
        query.datasource,
        query.view,
        {
          workspaceId: query.workspaceId?.trim() || this.resolveWorkspaceId(req)
        }
      );
      return ok(req.requestId, sessions);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Patch("/sessions/:sessionId")
  async renameSession(
    @Param("sessionId") sessionId: string,
    @Body() body: RenameSessionDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      if (
        body.title === undefined &&
        body.debugEnabled === undefined &&
        body.modelCatalogId === undefined
      ) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "至少需要提供 title、debugEnabled 或 modelCatalogId",
          400
        );
      }
      const session = await this.chatService.updateSession(sessionId, {
        title: body.title,
        debugEnabled: body.debugEnabled,
        modelCatalogId: body.modelCatalogId
      });
      return ok(req.requestId, session);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Delete("/sessions/:sessionId")
  async deleteSession(
    @Param("sessionId") sessionId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      await this.chatService.deleteSession(sessionId);
      return ok(req.requestId, { deleted: true, sessionId });
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Post("/sessions/:sessionId/messages")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  )
  async sendMessage(
    @Param("sessionId") sessionId: string,
    @Body() body: SendMessageDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<AgentRunResponse>> {
    try {
      const run = await this.chatService.sendMessage(
        sessionId,
        body.message,
        req.requestId,
        body.contextEnvelope,
        req.actor
      );
      return ok(req.requestId, {
        kind: "agent-run",
        outcome: run.status,
        run,
        delivery: run.delivery,
        agent: {
          provider: run.provider,
          model: run.model,
          hasSql: Boolean(run.sql),
          hasToolCalls: Boolean(run.trace.toolCalls?.length),
          hasError: Boolean(run.error)
        }
      });
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Post("/models/:modelCatalogId/probe")
  async probeModel(
    @Param("modelCatalogId") modelCatalogId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const result = await this.chatService.probeModelConnectivity(modelCatalogId);
      return ok(req.requestId, result);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Post("/sessions/:sessionId/messages/stream")
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true
    })
  )
  async streamMessage(
    @Param("sessionId") sessionId: string,
    @Body() body: SendMessageDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const sendEvent = (type: string, data: unknown) => {
      if (res.writableEnded) {
        return;
      }
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await this.chatService.streamMessage(
        sessionId,
        body.message,
        req.requestId,
        async (event) => {
          sendEvent(event.type, event);
        },
        body.contextEnvelope,
        req.actor
      );
    } catch (error) {
      const fallbackEvent: ChatStreamEvent = {
        type: "error",
        runId: "unavailable",
        sessionId,
        at: new Date().toISOString(),
        data:
          error instanceof DomainError
            ? {
                code: error.code,
                message: error.message,
                details: error.details ?? null
              }
            : {
                code: "INTERNAL_ERROR",
                message: error instanceof Error ? error.message : "未知错误",
                details: null
              }
      };
      sendEvent("error", fallbackEvent);
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  }

  @Get("/sessions/:sessionId/messages")
  async getMessages(
    @Param("sessionId") sessionId: string,
    @Query("page") pageRaw = "1",
    @Query("pageSize") pageSizeRaw = "0",
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const page = Number.parseInt(pageRaw, 10) || 1;
      const parsedPageSize = Number.parseInt(pageSizeRaw, 10);
      const pageSize = Number.isNaN(parsedPageSize) ? 0 : parsedPageSize;
      const data = await this.chatService.getSessionView(sessionId, page, pageSize);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Get("/runs/:runId")
  async getRun(
    @Param("runId") runId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const run = await this.chatService.getRunById(runId);
      return ok(req.requestId, run);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Post("/runs/:runId/save-as-view")
  async saveViewFromRun(
    @Param("runId") runId: string,
    @Body() body: SaveViewFromRunDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.chatService.saveViewFromRun({
        runId,
        name: body.name,
        displayName: body.displayName,
        description: body.description,
        actorId: req.actor?.id
      });
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error, res);
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

  private resolveWorkspaceId(req: Request): string | undefined {
    const headerValue = req.headers["x-workspace-id"];
    if (typeof headerValue === "string") {
      const trimmed = headerValue.trim();
      return trimmed ? trimmed : undefined;
    }
    if (Array.isArray(headerValue)) {
      const first = headerValue.at(0)?.trim();
      return first ? first : undefined;
    }
    return undefined;
  }
}
