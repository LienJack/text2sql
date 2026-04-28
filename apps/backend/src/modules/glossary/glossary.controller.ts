import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type {
  ApiResponse,
  CreateGlossaryAnchorRequest,
  ListGlossaryAnchorsRequest
} from "@text2sql/shared-types";
import type { Request } from "express";
import { fail, ok } from "../../common/api-response";
import { DomainError } from "../../common/domain-error";
import { AdminOnlyGuard } from "../auth/admin-only.guard";
import { CreateGlossaryTermDto } from "./dto/create-glossary-term.dto";
import { ListGlossaryTermsQueryDto } from "./dto/list-glossary-terms.query.dto";
import { RollbackGlossaryAnchorDto } from "./dto/rollback-glossary-anchor.dto";
import { UpdateGlossaryTermDto } from "./dto/update-glossary-term.dto";
import { GlossaryService } from "./glossary.service";

@Controller("/api/v1/glossary")
export class GlossaryController {
  constructor(private readonly glossaryService: GlossaryService) {}

  @Get("/terms")
  async listTerms(
    @Query() query: ListGlossaryTermsQueryDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.glossaryService.listTerms(query);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/terms")
  @UseGuards(AdminOnlyGuard)
  async createTerm(
    @Body() body: CreateGlossaryTermDto,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.glossaryService.createTerm(
        body,
        req.actor,
        idempotencyKey,
        req.requestId
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Patch("/terms/:termId")
  @UseGuards(AdminOnlyGuard)
  async updateTerm(
    @Param("termId") termId: string,
    @Body() body: UpdateGlossaryTermDto,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.glossaryService.updateTerm(
        termId,
        body,
        req.actor,
        idempotencyKey,
        req.requestId
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/terms/:termId/toggle")
  @UseGuards(AdminOnlyGuard)
  async toggleTerm(
    @Param("termId") termId: string,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.glossaryService.toggleTerm(
        termId,
        req.actor,
        idempotencyKey,
        req.requestId
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/anchors/rollback")
  @UseGuards(AdminOnlyGuard)
  async rollbackAnchor(
    @Body() body: RollbackGlossaryAnchorDto,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.glossaryService.rollbackAnchor(
        body,
        req.actor,
        idempotencyKey,
        req.requestId
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Get("/anchors")
  async listAnchors(
    @Query() query: ListGlossaryAnchorsRequest & { page?: string; pageSize?: string },
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.glossaryService.listAnchors({
        scope: query.scope,
        datasourceId: query.datasourceId,
        anchorType: query.anchorType,
        page: query.page ? Number(query.page) : undefined,
        pageSize: query.pageSize ? Number(query.pageSize) : undefined
      });
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/anchors")
  @UseGuards(AdminOnlyGuard)
  async createAnchor(
    @Body() body: CreateGlossaryAnchorRequest,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.glossaryService.createAnchor(
        body,
        req.actor,
        idempotencyKey,
        req.requestId
      );
      return ok(req.requestId, data);
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
