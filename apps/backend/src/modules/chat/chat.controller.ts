import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req
} from "@nestjs/common";
import type { Request } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { fail, ok } from "../../common/api-response";
import { DomainError } from "../../common/domain-error";
import { CreateSessionDto } from "./dto/create-session.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { ChatService } from "./chat.service";

@Controller("/api/v1")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post("/sessions")
  async createSession(
    @Body() body: CreateSessionDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const session = await this.chatService.createSession(
        body.datasource ?? "sqlite_main"
      );
      return ok(req.requestId, session);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/sessions/:sessionId/messages")
  async sendMessage(
    @Param("sessionId") sessionId: string,
    @Body() body: SendMessageDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const run = await this.chatService.sendMessage(sessionId, body.message);
      const responseType =
        run.status === "clarification"
          ? "clarification"
          : run.status === "executionResult"
            ? "executionResult"
            : "sqlPreview";
      return ok(req.requestId, {
        responseType,
        run
      });
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Get("/sessions/:sessionId/messages")
  async getMessages(
    @Param("sessionId") sessionId: string,
    @Query("page") pageRaw = "1",
    @Query("pageSize") pageSizeRaw = "50",
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const page = Number.parseInt(pageRaw, 10) || 1;
      const pageSize = Number.parseInt(pageSizeRaw, 10) || 50;
      const data = await this.chatService.listMessages(sessionId, page, pageSize);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Get("/runs/:runId")
  async getRun(
    @Param("runId") runId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const run = await this.chatService.getRunById(runId);
      return ok(req.requestId, run);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  private toError(requestId: string, error: unknown): ApiResponse<never> {
    if (error instanceof DomainError) {
      return fail(requestId, error.code, error.message, error.details);
    }
    return fail(
      requestId,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "未知错误"
    );
  }
}
