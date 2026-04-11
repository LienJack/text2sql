import { Injectable } from "@nestjs/common";
import type { SettingsActor } from "@text2sql/shared-types";
import { ProviderCatalogService } from "../llm/provider-catalog.service";
import { CreateProviderDto } from "./dto/create-provider.dto";

@Injectable()
export class SettingsService {
  constructor(private readonly providerCatalog: ProviderCatalogService) {}

  async getSettingsView(actor: SettingsActor) {
    return this.providerCatalog.listSettingsView(actor);
  }

  async listSupportedProviders() {
    return this.providerCatalog.listSupportedProviders();
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

  async setModelEnabled(modelId: string, enabled: boolean) {
    return this.providerCatalog.setModelEnabled(modelId, enabled);
  }
}
