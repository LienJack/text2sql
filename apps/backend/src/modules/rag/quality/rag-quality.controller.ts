import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { ok } from "../../../common/api-response";
import {
  RagQualityService,
  type RagQualityEvaluationInput
} from "./rag-quality.service";

@Controller("/api/v1/rag/quality")
export class RagQualityController {
  constructor(private readonly ragQualityService: RagQualityService) {}

  @Get("/report")
  report(@Req() req: Request): ApiResponse<unknown> {
    return ok(req.requestId, this.ragQualityService.snapshot());
  }

  @Post("/report")
  record(
    @Body() body: RagQualityEvaluationInput,
    @Req() req: Request
  ): ApiResponse<unknown> {
    this.ragQualityService.recordEvaluation(body);
    return ok(req.requestId, this.ragQualityService.snapshot());
  }

  @Get("/replay/:runId")
  async replay(
    @Param("runId") runId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    const report = await this.ragQualityService.getReplayCompleteness(runId);
    return ok(req.requestId, report);
  }
}
