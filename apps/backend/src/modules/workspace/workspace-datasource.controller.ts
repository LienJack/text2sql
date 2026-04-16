import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import type { Request } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { fail, ok } from "../../common/api-response";
import { DomainError } from "../../common/domain-error";
import { WorkspaceAdminGuard } from "../auth/workspace-admin.guard";
import { ListWorkspaceDatasourceTablePermissionsDto } from "./dto/list-workspace-datasource-table-permissions.dto";
import { ReplaceWorkspaceDatasourceTablePermissionsDto } from "./dto/replace-workspace-datasource-table-permissions.dto";
import { WorkspaceDatasourceBindingBatchDto } from "./dto/workspace-datasource-binding-batch.dto";
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

  @Get(":workspaceId/datasources/:datasourceId/table-permissions")
  async listDatasourceTablePermissions(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Query() query: ListWorkspaceDatasourceTablePermissionsDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data =
        await this.workspaceDatasourceService.listDatasourceTablePermissions(
          req.actor,
          workspaceId,
          datasourceId,
          {
            keyword: query.keyword
          }
        );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Put(":workspaceId/datasources/:datasourceId/table-permissions")
  async replaceDatasourceTablePermissions(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: ReplaceWorkspaceDatasourceTablePermissionsDto,
    @Headers("x-idempotency-key") idempotencyKey: string | undefined,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data =
        await this.workspaceDatasourceService.replaceDatasourceTablePermissions(
          req.actor,
          workspaceId,
          datasourceId,
          body,
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
