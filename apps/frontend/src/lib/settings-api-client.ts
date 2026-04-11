import type {
  ApiResponse,
  LlmProviderCode,
  LlmSettingsView,
  ModelCatalogItem,
  ProviderConfig
} from "@text2sql/shared-types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";

type SupportedProvider = {
  provider: LlmProviderCode;
  displayName: string;
  defaultBaseUrl: string;
  supportsModelListing: boolean;
};

export type ProviderPayload = {
  provider: LlmProviderCode;
  displayName?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const role = process.env.NEXT_PUBLIC_USER_ROLE === "user" ? "user" : "admin";
  const userId = process.env.NEXT_PUBLIC_USER_ID ?? "frontend-admin";
  const response = await fetch(`${API_BASE}${url}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-user-role": role,
      "x-user-id": userId,
      ...(init?.headers ?? {})
    }
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (payload.status === "error") {
    throw new Error(
      `${payload.error.message}${
        payload.error.code ? ` [${payload.error.code}]` : ""
      }`
    );
  }
  return payload.data;
}

export async function fetchSettingsView(): Promise<LlmSettingsView> {
  return request<LlmSettingsView>("/api/v1/settings/models");
}

export async function fetchSupportedProviders(): Promise<SupportedProvider[]> {
  return request<SupportedProvider[]>("/api/v1/settings/providers/supported");
}

export async function createProviderConfig(
  payload: ProviderPayload
): Promise<ProviderConfig> {
  return request<ProviderConfig>("/api/v1/settings/providers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateProviderConfig(
  providerConfigId: string,
  payload: ProviderPayload
): Promise<ProviderConfig> {
  return request<ProviderConfig>(`/api/v1/settings/providers/${providerConfigId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function deleteProviderConfig(
  providerConfigId: string
): Promise<{ deleted: boolean; providerConfigId: string }> {
  return request<{ deleted: boolean; providerConfigId: string }>(
    `/api/v1/settings/providers/${providerConfigId}`,
    {
      method: "DELETE"
    }
  );
}

export async function syncProviderModels(providerConfigId: string): Promise<{
  provider: ProviderConfig;
  syncedModels: ModelCatalogItem[];
}> {
  return request<{
    provider: ProviderConfig;
    syncedModels: ModelCatalogItem[];
  }>(`/api/v1/settings/providers/${providerConfigId}/sync`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function checkProviderHealth(providerConfigId: string): Promise<{
  provider: ProviderConfig;
  status: string;
  message: string;
  checkedAt: string;
  latencyMs: number;
}> {
  return request<{
    provider: ProviderConfig;
    status: string;
    message: string;
    checkedAt: string;
    latencyMs: number;
  }>(`/api/v1/settings/providers/${providerConfigId}/health`, {
    method: "POST"
  });
}

export async function setModelEnabled(
  modelId: string,
  enabled: boolean
): Promise<ModelCatalogItem> {
  return request<ModelCatalogItem>(`/api/v1/settings/models/${modelId}`, {
    method: "PATCH",
    body: JSON.stringify({
      enabled
    })
  });
}
