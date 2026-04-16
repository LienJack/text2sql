import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmSettingsView } from "@text2sql/shared-types";
import SettingsPage from "@/app/settings/page";
import { listWorkspaces } from "@/lib/admin-api-client";
import {
  batchSetModelsEnabled,
  checkProviderHealth,
  createProviderConfig,
  deleteProviderConfig,
  fetchModelStatuses,
  fetchSettingsView,
  fetchSupportedProviders,
  setModelEnabled,
  syncProviderModels
} from "@/lib/settings-api-client";

vi.mock("@/components/settings/model-catalog-table", () => ({
  ModelCatalogTable: () => <div>model-catalog-table</div>
}));

vi.mock("@/components/settings/provider-config-sheet", () => ({
  ProviderConfigSheet: () => <div>provider-config-sheet</div>
}));

vi.mock("@/components/settings/users-management-panel", () => ({
  UsersManagementPanel: () => <div>users-management-panel</div>
}));

vi.mock("@/components/settings/workspace-management-panel", () => ({
  WorkspaceManagementPanel: () => <div>workspace-management-panel</div>
}));

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn()
  };
});

vi.mock("@/lib/settings-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings-api-client")>();
  return {
    ...actual,
    fetchSettingsView: vi.fn(),
    fetchSupportedProviders: vi.fn(),
    fetchModelStatuses: vi.fn(),
    syncProviderModels: vi.fn(),
    checkProviderHealth: vi.fn(),
    deleteProviderConfig: vi.fn(),
    setModelEnabled: vi.fn(),
    batchSetModelsEnabled: vi.fn(),
    createProviderConfig: vi.fn()
  };
});

const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockFetchSettingsView = vi.mocked(fetchSettingsView);
const mockFetchSupportedProviders = vi.mocked(fetchSupportedProviders);
const mockFetchModelStatuses = vi.mocked(fetchModelStatuses);
const mockSyncProviderModels = vi.mocked(syncProviderModels);
const mockCheckProviderHealth = vi.mocked(checkProviderHealth);
const mockDeleteProviderConfig = vi.mocked(deleteProviderConfig);
const mockSetModelEnabled = vi.mocked(setModelEnabled);
const mockBatchSetModelsEnabled = vi.mocked(batchSetModelsEnabled);
const mockCreateProviderConfig = vi.mocked(createProviderConfig);

function createSettingsView(role: "admin" | "user"): LlmSettingsView {
  return {
    actor: {
      id: role === "admin" ? "frontend-admin" : "frontend-user",
      role
    },
    providers: [],
    models: []
  };
}

describe("SettingsPage governance visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchSupportedProviders.mockResolvedValue([]);
    mockFetchModelStatuses.mockResolvedValue([]);
    mockSyncProviderModels.mockResolvedValue({
      provider: {
        id: "provider-1",
        provider: "openai",
        displayName: "OpenAI",
        baseUrl: null,
        enabled: true,
        hasApiKey: true,
        apiKeyMasked: null,
        lastSyncAt: null,
        lastSyncStatus: "healthy",
        lastSyncError: null,
        modelCount: 0,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z"
      },
      syncedModels: []
    });
    mockCheckProviderHealth.mockResolvedValue({
      provider: {
        id: "provider-1",
        provider: "openai",
        displayName: "OpenAI",
        baseUrl: null,
        enabled: true,
        hasApiKey: true,
        apiKeyMasked: null,
        lastSyncAt: null,
        lastSyncStatus: "healthy",
        lastSyncError: null,
        modelCount: 0,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z"
      },
      status: "ok",
      message: "ok",
      checkedAt: "2026-04-16T00:00:00.000Z",
      latencyMs: 1
    });
    mockDeleteProviderConfig.mockResolvedValue({
      deleted: true,
      providerConfigId: "provider-1"
    });
    mockSetModelEnabled.mockResolvedValue({
      id: "model-1",
      providerConfigId: "provider-1",
      provider: "openai",
      model: "gpt-5.4",
      displayName: "GPT-5.4",
      capabilities: [],
      contextWindow: null,
      enabled: true,
      healthStatus: "healthy",
      lastHealthCheckAt: null,
      lastSyncedAt: null,
      metadata: {},
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z"
    });
    mockBatchSetModelsEnabled.mockResolvedValue({ updated: 0 });
    mockCreateProviderConfig.mockResolvedValue({
      id: "provider-1",
      provider: "openai",
      displayName: "OpenAI",
      baseUrl: null,
      enabled: true,
      hasApiKey: true,
      apiKeyMasked: null,
      lastSyncAt: null,
      lastSyncStatus: "healthy",
      lastSyncError: null,
      modelCount: 0,
      createdAt: "2026-04-16T00:00:00.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z"
    });

    mockListWorkspaces.mockResolvedValue({
      items: [
        {
          id: "ws-1",
          name: "默认空间",
          isDefault: true,
          memberCount: 1,
          createdAt: "2026-04-16T00:00:00.000Z"
        }
      ],
      total: 1,
      page: 1,
      pageSize: 200
    });
  });

  it("shows governance tabs for admin actor", async () => {
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    render(<SettingsPage />);

    expect(await screen.findByText("用户列表")).toBeInTheDocument();
    expect(screen.getByText("工作空间")).toBeInTheDocument();
    expect(screen.getByText("LLM 模型")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockListWorkspaces).toHaveBeenCalledTimes(1);
    });
  });

  it("hides governance tabs for non-admin actor", async () => {
    mockFetchSettingsView.mockResolvedValue(createSettingsView("user"));
    render(<SettingsPage />);

    expect(await screen.findByText("LLM 模型")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockFetchSettingsView).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("用户列表")).not.toBeInTheDocument();
    expect(screen.queryByText("工作空间")).not.toBeInTheDocument();
    expect(screen.getByText("model-catalog-table")).toBeInTheDocument();
    expect(mockListWorkspaces).not.toHaveBeenCalled();
  });
});
