import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmSettingsView, RagTaskSettingsView } from "@text2sql/shared-types";
import SettingsPage from "@/app/settings/page";
import { listGlossaryAnchors, listWorkspaces } from "@/lib/admin-api-client";
import {
  batchSetModelsEnabled,
  checkProviderHealth,
  checkRagTaskConfigHealth,
  createProviderConfig,
  deleteProviderConfig,
  fetchBackendHealthSnapshot,
  fetchModelStatuses,
  fetchRagQualityReport,
  fetchRagReplayCompleteness,
  fetchRagTaskConfigs,
  fetchSettingsView,
  fetchSupportedProviders,
  setModelEnabled,
  submitRagMemoryFeedback,
  syncProviderModels,
  upsertRagTaskConfig
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
    listWorkspaces: vi.fn(),
    listGlossaryAnchors: vi.fn()
  };
});

vi.mock("@/lib/settings-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings-api-client")>();
  return {
    ...actual,
    fetchSettingsView: vi.fn(),
    fetchSupportedProviders: vi.fn(),
    fetchRagTaskConfigs: vi.fn(),
    upsertRagTaskConfig: vi.fn(),
    checkRagTaskConfigHealth: vi.fn(),
    fetchBackendHealthSnapshot: vi.fn(),
    fetchRagQualityReport: vi.fn(),
    fetchRagReplayCompleteness: vi.fn(),
    submitRagMemoryFeedback: vi.fn(),
    fetchModelStatuses: vi.fn(),
    syncProviderModels: vi.fn(),
    checkProviderHealth: vi.fn(),
    deleteProviderConfig: vi.fn(),
    setModelEnabled: vi.fn(),
    batchSetModelsEnabled: vi.fn(),
    createProviderConfig: vi.fn()
  };
});

const mockFetchSettingsView = vi.mocked(fetchSettingsView);
const mockFetchSupportedProviders = vi.mocked(fetchSupportedProviders);
const mockFetchRagTaskConfigs = vi.mocked(fetchRagTaskConfigs);
const mockUpsertRagTaskConfig = vi.mocked(upsertRagTaskConfig);
const mockCheckRagTaskConfigHealth = vi.mocked(checkRagTaskConfigHealth);
const mockFetchBackendHealthSnapshot = vi.mocked(fetchBackendHealthSnapshot);
const mockFetchRagQualityReport = vi.mocked(fetchRagQualityReport);
const mockFetchRagReplayCompleteness = vi.mocked(fetchRagReplayCompleteness);
const mockSubmitRagMemoryFeedback = vi.mocked(submitRagMemoryFeedback);
const mockFetchModelStatuses = vi.mocked(fetchModelStatuses);
const mockSyncProviderModels = vi.mocked(syncProviderModels);
const mockCheckProviderHealth = vi.mocked(checkProviderHealth);
const mockDeleteProviderConfig = vi.mocked(deleteProviderConfig);
const mockSetModelEnabled = vi.mocked(setModelEnabled);
const mockBatchSetModelsEnabled = vi.mocked(batchSetModelsEnabled);
const mockCreateProviderConfig = vi.mocked(createProviderConfig);
const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListGlossaryAnchors = vi.mocked(listGlossaryAnchors);

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

function createRagTaskView(role: "admin" | "user"): RagTaskSettingsView {
  return {
    actor: {
      id: role === "admin" ? "frontend-admin" : "frontend-user",
      role
    },
    items: [
      {
        id: "rag-embedding",
        taskType: "embedding",
        provider: "openai",
        model: "text-embedding-3-small",
        baseUrl: "https://api.openai.com/v1",
        enabled: true,
        hasApiKey: true,
        apiKeyMasked: "sk-e***1234",
        dimensions: 1536,
        vectorVersion: "v1",
        timeoutMs: 30000,
        note: null,
        healthStatus: "unknown",
        lastCheckedAt: null,
        lastHealthLatencyMs: null,
        lastHealthMessage: null,
        lastError: null,
        configSource: "settings",
        configSourceNote: null,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z"
      },
      {
        id: "rag-rerank",
        taskType: "rerank",
        provider: "openai",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        enabled: true,
        hasApiKey: true,
        apiKeyMasked: "sk-r***1234",
        dimensions: null,
        vectorVersion: null,
        timeoutMs: 5000,
        note: null,
        healthStatus: "unknown",
        lastCheckedAt: null,
        lastHealthLatencyMs: null,
        lastHealthMessage: null,
        lastError: null,
        configSource: "settings",
        configSourceNote: null,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:00:00.000Z"
      }
    ]
  };
}

describe("SettingsPage rag config tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchSupportedProviders.mockResolvedValue([]);
    mockFetchRagTaskConfigs.mockResolvedValue(createRagTaskView("admin"));
    mockUpsertRagTaskConfig.mockResolvedValue(createRagTaskView("admin").items[0]!);
    mockCheckRagTaskConfigHealth.mockResolvedValue({
      taskType: "embedding",
      status: "healthy",
      reasonCode: "ok",
      message: "ok",
      checkedAt: "2026-04-16T00:00:00.000Z",
      latencyMs: 1,
      configSource: "settings",
      checkedAgainst: "draft"
    });
    mockFetchBackendHealthSnapshot.mockResolvedValue({
      status: "ok",
      dependencies: {
        ragIngestionMetrics: {
          foundation: {
            activeIndexSummary: {
              total: 1,
              items: [
                {
                  datasourceId: "ds-1",
                  indexVersionId: "idx-v1",
                  sourceVersion:
                    "semantic-assets-aaa:openai:text-embedding-3-small:v1:settings:schema",
                  activatedAt: "2026-04-16T00:00:00.000Z"
                }
              ]
            }
          }
        }
      }
    });
    mockFetchRagQualityReport.mockResolvedValue({
      thresholds: {
        recallAt20Min: 0.7,
        mrrAt10Min: 0.6,
        retrievalRerankP95MsMax: 500,
        degradeRateMax: 0.3,
        minSamples: 10
      },
      sampleSize: 0,
      sampleReady: false,
      gatePass: false,
      reasons: [],
      generatedAt: "2026-04-16T00:00:00.000Z"
    });
    mockFetchRagReplayCompleteness.mockResolvedValue({
      runId: "none",
      requiredStages: [],
      observedStages: [],
      missingStages: [],
      completeness: 1,
      ready: true
    });
    mockSubmitRagMemoryFeedback.mockResolvedValue({
      runId: "none",
      candidateId: "none",
      beforeStatus: "candidate",
      afterStatus: "verified",
      applied: true,
      updatedAt: "2026-04-16T00:00:00.000Z"
    });
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
      status: "healthy",
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
      items: [],
      total: 0,
      page: 1,
      pageSize: 200
    });
    mockListGlossaryAnchors.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50
    });
  });

  it("shows rag config tab and panels for admin", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    render(<SettingsPage />);

    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "RAG 配置" }));

    expect(await screen.findByText("Embedding 配置")).toBeInTheDocument();
    expect(screen.getByText("Rerank 配置")).toBeInTheDocument();
    expect(screen.getByText("Active Index Profile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存 Embedding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存 Rerank" })).toBeInTheDocument();
  });

  it("shows readonly rag config state for user", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValue(createSettingsView("user"));
    mockFetchRagTaskConfigs.mockResolvedValue(createRagTaskView("user"));
    render(<SettingsPage />);

    await screen.findByText("LLM 模型");
    await user.click(screen.getByRole("tab", { name: "RAG 配置" }));

    expect(await screen.findByText("Embedding 配置")).toBeInTheDocument();
    expect(screen.getAllByText("当前账号只读，可查看配置摘要。").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "保存 Embedding" })).not.toBeInTheDocument();
  });

  it("passes current draft payload when checking embedding health", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    render(<SettingsPage />);

    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "RAG 配置" }));

    const providerInput = screen.getByLabelText("embedding-provider");
    const modelInput = screen.getByLabelText("embedding-model");
    const baseUrlInput = screen.getByLabelText("embedding-base-url");
    const apiKeyInput = screen.getByLabelText("embedding-api-key");

    await user.clear(providerInput);
    await user.type(providerInput, "volcengine");
    await user.clear(modelInput);
    await user.type(modelInput, "doubao-embedding-large");
    await user.clear(baseUrlInput);
    await user.type(baseUrlInput, "https://ark.cn-beijing.volces.com/api/v3");
    await user.type(apiKeyInput, "sk-draft-embedding");
    const embeddingSection = screen.getByText("Embedding 配置").closest("section");
    if (!embeddingSection) {
      throw new Error("embedding section not found");
    }
    await user.click(
      within(embeddingSection).getByRole("button", { name: "检测草稿（不保存）" })
    );

    expect(mockCheckRagTaskConfigHealth).toHaveBeenCalledWith(
      "embedding",
      expect.objectContaining({
        draft: expect.objectContaining({
          provider: "volcengine",
          model: "doubao-embedding-large",
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          apiKey: "sk-draft-embedding"
        })
      })
    );
  });
});
