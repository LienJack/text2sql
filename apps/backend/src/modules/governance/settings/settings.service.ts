import { Injectable } from "@nestjs/common";
import type { LlmProviderCode, SettingsActor } from "@text2sql/shared-types";
import { ProviderCatalogService } from "../../llm/provider-catalog.service";
import {
  type CheckRagTaskConfigHealthContext,
  type CheckRagTaskConfigHealthInput,
  type UpsertRagTaskConfigInput,
  RagTaskConfigService
} from "../../llm/rag-task-config.service";
import { CreateProviderDto } from "./dto/create-provider.dto";
import { CreatePromptTemplateDto } from "./dto/create-prompt-template.dto";
import { ListPromptTemplatesQueryDto } from "./dto/list-prompt-templates.query.dto";
import { UpdatePromptTemplateDto } from "./dto/update-prompt-template.dto";
import { PromptTemplateService } from "./prompt-template.service";
import type { RagTaskType } from "@text2sql/shared-types";

@Injectable()
export class SettingsService {
  constructor(
    private readonly providerCatalog: ProviderCatalogService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly ragTaskConfigService: RagTaskConfigService
  ) {}

  async getSettingsView(actor: SettingsActor) {
    return this.providerCatalog.listSettingsView(actor);
  }

  async listSupportedProviders() {
    return this.providerCatalog.listSupportedProviders();
  }

  async listRagTaskConfigs(actor: SettingsActor) {
    return this.ragTaskConfigService.listSettingsView(actor);
  }

  async upsertRagTaskConfig(
    actor: SettingsActor,
    taskType: RagTaskType,
    body: UpsertRagTaskConfigInput
  ) {
    return this.ragTaskConfigService.upsertConfig(taskType, body, actor);
  }

  async checkRagTaskConfigHealth(
    taskType: RagTaskType,
    body: CheckRagTaskConfigHealthInput,
    context?: CheckRagTaskConfigHealthContext
  ) {
    return this.ragTaskConfigService.checkConfigHealth(taskType, body, context);
  }

  async previewRagProviderModels(
    taskType: RagTaskType,
    body: {
      provider: LlmProviderCode;
      baseUrl?: string;
      apiKey: string;
    }
  ) {
    return this.providerCatalog.previewProviderModels({
      taskType,
      provider: body.provider,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey
    });
  }

  async createProvider(actor: SettingsActor, body: CreateProviderDto) {
    return this.providerCatalog.createOrUpdateProvider({
      actor,
      provider: body.provider,
      displayName: body.displayName,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      enabled: body.enabled
    });
  }

  async updateProvider(
    actor: SettingsActor,
    providerConfigId: string,
    body: CreateProviderDto
  ) {
    return this.providerCatalog.createOrUpdateProvider({
      id: providerConfigId,
      actor,
      provider: body.provider,
      displayName: body.displayName,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      enabled: body.enabled
    });
  }

  async deleteProvider(providerConfigId: string) {
    await this.providerCatalog.deleteProvider(providerConfigId);
    return {
      deleted: true,
      providerConfigId
    };
  }

  async syncProvider(providerConfigId: string) {
    return this.providerCatalog.syncProviderModels(providerConfigId);
  }

  async checkProviderHealth(providerConfigId: string) {
    return this.providerCatalog.checkProviderHealth(providerConfigId);
  }

  async listModelStatuses() {
    return this.providerCatalog.listModelStatuses();
  }

  async batchSetModelsEnabled(modelIds: string[], enabled: boolean) {
    return this.providerCatalog.batchSetModelsEnabled(modelIds, enabled);
  }

  async setModelEnabled(modelId: string, enabled: boolean) {
    return this.providerCatalog.setModelEnabled(modelId, enabled);
  }

  async listPromptTemplates(query: ListPromptTemplatesQueryDto) {
    return this.promptTemplateService.listTemplates(query);
  }

  async createPromptTemplate(
    actor: SettingsActor | undefined,
    body: CreatePromptTemplateDto
  ) {
    return this.promptTemplateService.createTemplate(body, actor);
  }

  async updatePromptTemplate(
    actor: SettingsActor | undefined,
    templateId: string,
    body: UpdatePromptTemplateDto
  ) {
    return this.promptTemplateService.updateTemplate(templateId, body, actor);
  }

  async deletePromptTemplate(actor: SettingsActor | undefined, templateId: string) {
    return this.promptTemplateService.softDeleteTemplate(templateId, actor);
  }
}
