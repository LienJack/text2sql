import { Body, Controller, Get, Headers, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { fail, ok } from "../../../common/api-response";
import { DomainError } from "../../../common/domain-error";
import { WorkspaceAdminGuard } from "../../auth/workspace-admin.guard";
import { UpsertModelingSetupDto } from "./dto/upsert-modeling-setup.dto";
import { WorkspaceModelingService } from "./workspace-modeling.service";

@Controller("/api/v1/system/workspaces")
@UseGuards(WorkspaceAdminGuard)
export class WorkspaceModelingController {
  constructor(
    private readonly workspaceModelingService: WorkspaceModelingService
  ) {}

  @Get(":workspaceId/datasources/:datasourceId/modeling/setup/tables")
  async listSetupTables(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingService.listSetupTables(
        req.actor,
        workspaceId,
        datasourceId
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Put(":workspaceId/datasources/:datasourceId/modeling/setup/tables")
  async saveSelectedTables(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: UpsertModelingSetupDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingService.saveSelectedTables(
        req.actor,
        workspaceId,
        datasourceId,
        body
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post(":workspaceId/datasources/:datasourceId/modeling/setup/relationships/recommend")
  async recommendRelationships(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: UpsertModelingSetupDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingService.recommendSetupRelationships(
        req.actor,
        workspaceId,
        datasourceId,
        body
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post(":workspaceId/datasources/:datasourceId/modeling/setup/preview")
  async previewSetup(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: UpsertModelingSetupDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingService.previewSetup(
        req.actor,
        workspaceId,
        datasourceId,
        body
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post(":workspaceId/datasources/:datasourceId/modeling/setup/commit")
  async commitSetup(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: UpsertModelingSetupDto,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingService.commitSetup(
        req.actor,
        workspaceId,
        datasourceId,
        body,
        idempotencyKey
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
