import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiResponse } from "@text2sql/shared-types";
import { fail, ok } from "../../../common/api-response";
import { DomainError } from "../../../common/domain-error";
import { AdminOnlyGuard } from "../../auth/admin-only.guard";
import { BatchUpdateModelStatusDto } from "./dto/batch-update-model-status.dto";
import { CreatePromptTemplateDto } from "./dto/create-prompt-template.dto";
import { CreateProviderDto } from "./dto/create-provider.dto";
import { ListPromptTemplatesQueryDto } from "./dto/list-prompt-templates.query.dto";
import { RefreshProviderModelsDto } from "./dto/refresh-provider-models.dto";
import { UpdatePromptTemplateDto } from "./dto/update-prompt-template.dto";
import { UpdateModelStatusDto } from "./dto/update-model-status.dto";
import { SettingsService } from "./settings.service";

@Controller("/api/v1/settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get("/models")
  async getSettingsView(@Req() req: Request): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.getSettingsView(req.actor);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Get("/providers/supported")
  async listSupportedProviders(@Req() req: Request): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.listSupportedProviders();
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Get("/prompts")
  async listPromptTemplates(
    @Query() query: ListPromptTemplatesQueryDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.listPromptTemplates(query);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/prompts")
  @UseGuards(AdminOnlyGuard)
  async createPromptTemplate(
    @Body() body: CreatePromptTemplateDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.createPromptTemplate(req.actor, body);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Patch("/prompts/:templateId")
  @UseGuards(AdminOnlyGuard)
  async updatePromptTemplate(
    @Param("templateId") templateId: string,
    @Body() body: UpdatePromptTemplateDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.updatePromptTemplate(
        req.actor,
        templateId,
        body
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Delete("/prompts/:templateId")
  @UseGuards(AdminOnlyGuard)
  async deletePromptTemplate(
    @Param("templateId") templateId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.deletePromptTemplate(req.actor, templateId);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error, res);
    }
  }

  @Post("/providers")
  @UseGuards(AdminOnlyGuard)
  async createProvider(
    @Body() body: CreateProviderDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.createProvider(req.actor, body);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Patch("/providers/:providerConfigId")
  @UseGuards(AdminOnlyGuard)
  async updateProvider(
    @Param("providerConfigId") providerConfigId: string,
    @Body() body: CreateProviderDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.updateProvider(
        req.actor,
        providerConfigId,
        body
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Delete("/providers/:providerConfigId")
  @UseGuards(AdminOnlyGuard)
  async deleteProvider(
    @Param("providerConfigId") providerConfigId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.deleteProvider(providerConfigId);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/providers/:providerConfigId/sync")
  @UseGuards(AdminOnlyGuard)
  async syncProviderModels(
    @Param("providerConfigId") providerConfigId: string,
    @Body() _body: RefreshProviderModelsDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.syncProvider(providerConfigId);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Post("/providers/:providerConfigId/health")
  @UseGuards(AdminOnlyGuard)
  async checkProviderHealth(
    @Param("providerConfigId") providerConfigId: string,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.checkProviderHealth(providerConfigId);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Get("/models/status")
  async listModelStatuses(@Req() req: Request): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.listModelStatuses();
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Patch("/models/batch")
  @UseGuards(AdminOnlyGuard)
  async batchSetModelsEnabled(
    @Body() body: BatchUpdateModelStatusDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.batchSetModelsEnabled(
        body.modelIds,
        body.enabled
      );
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  @Patch("/models/:modelId")
  @UseGuards(AdminOnlyGuard)
  async setModelEnabled(
    @Param("modelId") modelId: string,
    @Body() body: UpdateModelStatusDto,
    @Req() req: Request
  ): Promise<ApiResponse<unknown>> {
    try {
      const data = await this.settingsService.setModelEnabled(modelId, body.enabled);
      return ok(req.requestId, data);
    } catch (error) {
      return this.toError(req.requestId, error);
    }
  }

  private toError(
    requestId: string,
    error: unknown,
    res?: Response
  ): ApiResponse<never> {
    if (error instanceof DomainError) {
      if (res) {
        res.status(error.statusCode);
      }
      return fail(requestId, error.code, error.message, error.details);
    }
    if (res) {
      res.status(500);
    }
    return fail(
      requestId,
      "INTERNAL_ERROR",
      error instanceof Error ? error.message : "未知错误"
    );
  }
}
