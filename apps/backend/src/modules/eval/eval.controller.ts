import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { fail, ok } from "../../common/api-response";
import { RunEvaluationDto } from "./dto/run-evaluation.dto";
import { EvalService } from "./eval.service";

@Controller("/api/v1/evaluations")
export class EvalController {
  constructor(private readonly evalService: EvalService) {}

  @Post("/run")
  async runEvaluation(
    @Body() body: RunEvaluationDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const report = await this.evalService.run(body.caseFilePath);
      return ok(req.requestId, report);
    } catch (error) {
      return fail(
        req.requestId,
        "EVALUATION_RUN_FAILED",
        error instanceof Error ? error.message : "评测运行失败"
      );
    }
  }

  @Get("/:jobId")
  async getReport(
    @Param("jobId") jobId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    const report = await this.evalService.getReport(jobId);
    if (!report) {
      return fail(req.requestId, "EVALUATION_NOT_FOUND", "评测结果不存在", { jobId });
    }
    return ok(req.requestId, report);
  }
}

