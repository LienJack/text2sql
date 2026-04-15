import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import type { Request } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { fail, ok } from "../../common/api-response";
import { DomainError } from "../../common/domain-error";
import { WorkspaceAdminGuard } from "../auth/workspace-admin.guard";
import { WorkspaceDatasourceBindingBatchDto } from "./dto/workspace-datasource-binding-batch.dto";
import { WorkspaceDatasourceTableAclRemoveDto } from "./dto/workspace-datasource-table-acl-remove.dto";
import { WorkspaceDatasourceTableAclReplaceDto } from "./dto/workspace-datasource-table-acl-replace.dto";
import { WorkspaceDatasourceService } from "./workspace-datasource.service";

@Controller("/api/v1/system/workspaces")
@UseGuards(WorkspaceAdminGuard)
export class WorkspaceDatasourceController {
  constructor(
    private readonly workspaceDatasourceService: WorkspaceDatasourceService
  ) {}

  @Get(":workspaceId/datasources/bindings")
  async listBindings(
    @Param("workspaceId") workspaceId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceDatasourceService.listBindings(
        req.actor,
        workspaceId
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post(":workspaceId/datasources/bindings/add")
  async addBindings(
    @Param("workspaceId") workspaceId: string,
    @Body() body: WorkspaceDatasourceBindingBatchDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceDatasourceService.bindDatasources(
        req.actor,
        workspaceId,
        body.datasourceIds
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post(":workspaceId/datasources/bindings/remove")
  async removeBindings(
    @Param("workspaceId") workspaceId: string,
    @Body() body: WorkspaceDatasourceBindingBatchDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceDatasourceService.unbindDatasources(
        req.actor,
        workspaceId,
        body.datasourceIds
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Get(":workspaceId/datasources/:datasourceId/table-acl")
  async listTableAcl(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceDatasourceService.listTableAcl(
        req.actor,
        workspaceId,
        datasourceId
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Get(":workspaceId/datasources/:datasourceId/tables")
  async listDatasourceTables(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceDatasourceService.listDatasourceTables(
        req.actor,
        workspaceId,
        datasourceId
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post(":workspaceId/datasources/:datasourceId/table-acl/replace")
  async replaceTableAcl(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: WorkspaceDatasourceTableAclReplaceDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceDatasourceService.replaceTableAcl(req.actor, {
        workspaceId,
        datasourceId,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        effect: body.effect,
        tableNames: body.tableNames,
        reason: body.reason
      });
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post(":workspaceId/datasources/:datasourceId/table-acl/remove")
  async removeTableAcl(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: WorkspaceDatasourceTableAclRemoveDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceDatasourceService.removeTableAcl(req.actor, {
        workspaceId,
        datasourceId,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        tableNames: body.tableNames,
        effect: body.effect
      });
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
