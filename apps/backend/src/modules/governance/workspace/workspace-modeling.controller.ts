import { Body, Controller, Get, Headers, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { fail, ok } from "../../../common/api-response";
import { DomainError } from "../../../common/domain-error";
import { WorkspaceAdminGuard } from "../../auth/workspace-admin.guard";
import { DetectModelingSchemaChangeDto } from "./dto/detect-modeling-schema-change.dto";
import { DeployModelingGraphDto } from "./dto/deploy-modeling-graph.dto";
import { GetModelingPreviewDto } from "./dto/get-modeling-preview.dto";
import { UpsertModelingGraphDto } from "./dto/upsert-modeling-graph.dto";
import { UpsertModelingSetupDto } from "./dto/upsert-modeling-setup.dto";
import { ResolveModelingSchemaChangeDto } from "./dto/resolve-modeling-schema-change.dto";
import { WorkspaceModelingDeployService } from "./workspace-modeling-deploy.service";
import { WorkspaceModelingService } from "./workspace-modeling.service";

@Controller("/api/v1/system/workspaces")
@UseGuards(WorkspaceAdminGuard)
export class WorkspaceModelingController {
  constructor(
    private readonly workspaceModelingService: WorkspaceModelingService,
    private readonly workspaceModelingDeployService: WorkspaceModelingDeployService
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

  @Get(":workspaceId/datasources/:datasourceId/modeling/graph")
  async getModelingGraph(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingService.getModelingGraph(
        req.actor,
        workspaceId,
        datasourceId
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Put(":workspaceId/datasources/:datasourceId/modeling/graph")
  async upsertModelingGraph(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: UpsertModelingGraphDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingService.upsertModelingGraph(
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

  @Post(":workspaceId/datasources/:datasourceId/modeling/preview")
  async getModelingPreview(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: GetModelingPreviewDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingService.getModelingPreview(
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

  @Post(":workspaceId/datasources/:datasourceId/modeling/schema-change/detect")
  async detectModelingSchemaChange(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: DetectModelingSchemaChangeDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingService.detectModelingSchemaChanges(
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

  @Post(":workspaceId/datasources/:datasourceId/modeling/schema-change/resolve")
  async resolveModelingSchemaChange(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: ResolveModelingSchemaChangeDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingService.resolveModelingSchemaChange(
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

  @Post(":workspaceId/datasources/:datasourceId/modeling/schema-change/:changeId/resolve")
  async resolveModelingSchemaChangeById(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Param("changeId") changeId: string,
    @Body() body: ResolveModelingSchemaChangeDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingService.resolveModelingSchemaChange(
        req.actor,
        workspaceId,
        datasourceId,
        {
          ...body,
          changeId
        }
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post(":workspaceId/datasources/:datasourceId/modeling/deploy/precheck")
  async precheckModelingDeploy(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: DeployModelingGraphDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingDeployService.precheck(
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

  @Post(":workspaceId/datasources/:datasourceId/modeling/deploy")
  async deployModelingGraph(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: DeployModelingGraphDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingDeployService.deploy(
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

  @Post(":workspaceId/datasources/:datasourceId/modeling/deploy/rollback")
  async rollbackModelingDeploy(
    @Param("workspaceId") workspaceId: string,
    @Param("datasourceId") datasourceId: string,
    @Body() body: DeployModelingGraphDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.workspaceModelingDeployService.rollback(
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
