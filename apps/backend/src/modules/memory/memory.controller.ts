import { Body, Controller, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { ApiResponse } from "@text2sql/shared-types";
import type { Request, Response } from "express";
import { fail, ok } from "../../common/api-response";
import { DomainError } from "../../common/domain-error";
import { AdminOnlyGuard } from "../auth/admin-only.guard";
import { ApplyMemoryFeedbackDto } from "./dto/apply-memory-feedback.dto";
import { MemoryPromotionService } from "./memory-promotion.service";

@Controller("/api/v1/rag/memory")
export class MemoryController {
  constructor(private readonly promotionService: MemoryPromotionService) {}

  @Post("/feedback")
  @UseGuards(AdminOnlyGuard)
  async applyFeedback(
    @Body() body: ApplyMemoryFeedbackDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const feedback = await this.promotionService.applyFeedback({
        runId: body.runId,
        targetStatus: body.targetStatus,
        note: body.note,
        actorId: req.actor?.id ?? "unknown",
        requestId: req.requestId
      });
      return ok(req.requestId, feedback);
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
}
