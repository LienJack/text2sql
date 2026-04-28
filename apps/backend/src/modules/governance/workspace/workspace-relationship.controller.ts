import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { fail, ok } from "../../../common/api-response";
import { DomainError } from "../../../common/domain-error";
import { WorkspaceAdminGuard } from "../../auth/workspace-admin.guard";
import { PublishWorkspaceRelationshipGraphDto } from "./dto/publish-workspace-relationship-graph.dto";
import { ReplaceWorkspaceRelationshipGraphDto } from "./dto/replace-workspace-relationship-graph.dto";
import { WorkspaceRelationshipService } from "./workspace-relationship.service";

@Controller("/api/v1/system/workspaces")
@UseGuards(WorkspaceAdminGuard)
export class WorkspaceRelationshipController {
  constructor(
    private readonly workspaceRelationshipService: WorkspaceRelationshipService
  ) {}

  @Get(":workspaceId/datasources/:datasourceId/relationships/draft")
  async getDraft(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceRelationshipService.getDraft(
        req.actor,
        workspaceId,
        datasourceId
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Put(":workspaceId/datasources/:datasourceId/relationships/draft")
  async replaceDraft(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: ReplaceWorkspaceRelationshipGraphDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceRelationshipService.replaceDraft(
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

  @Post(":workspaceId/datasources/:datasourceId/relationships/publish/precheck")
  async publishPrecheck(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: PublishWorkspaceRelationshipGraphDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceRelationshipService.publishPrecheck(
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

  @Post(":workspaceId/datasources/:datasourceId/relationships/publish")
  async publishDraft(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: PublishWorkspaceRelationshipGraphDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceRelationshipService.publishDraft(
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

  @Post(":workspaceId/datasources/:datasourceId/relationships/rollback")
  async rollback(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: PublishWorkspaceRelationshipGraphDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceRelationshipService.rollbackDraft(
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
