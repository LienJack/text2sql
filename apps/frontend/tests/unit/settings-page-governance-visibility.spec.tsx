import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LlmSettingsView,
  RagQualityGateReport,
  RagTaskSettingsView
} from "@text2sql/shared-types";
import SettingsPage from "@/app/settings/page";
import {
  AdminApiError,
  createGlossaryAnchor,
  listGlossaryAnchors,
  listWorkspaces,
  rollbackGlossaryAnchor
} from "@/lib/admin-api-client";
import {
  batchSetModelsEnabled,
  checkRagTaskConfigHealth,
  checkProviderHealth,
  createProviderConfig,
  deleteProviderConfig,
  fetchBackendHealthSnapshot,
  fetchModelStatuses,
  previewRagProviderModels,
  fetchRagTaskConfigs,
  fetchRagQualityReport,
  fetchRagReplayCompleteness,
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
    listGlossaryAnchors: vi.fn(),
    createGlossaryAnchor: vi.fn(),
    rollbackGlossaryAnchor: vi.fn()
  };
});

vi.mock("@/lib/settings-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings-api-client")>();
  return {
    ...actual,
    fetchSettingsView: vi.fn(),
    fetchSupportedProviders: vi.fn(),
    fetchRagTaskConfigs: vi.fn(),
    previewRagProviderModels: vi.fn(),
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

const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListGlossaryAnchors = vi.mocked(listGlossaryAnchors);
const mockCreateGlossaryAnchor = vi.mocked(createGlossaryAnchor);
const mockRollbackGlossaryAnchor = vi.mocked(rollbackGlossaryAnchor);
const mockFetchSettingsView = vi.mocked(fetchSettingsView);
const mockFetchSupportedProviders = vi.mocked(fetchSupportedProviders);
const mockFetchRagTaskConfigs = vi.mocked(fetchRagTaskConfigs);
const mockPreviewRagProviderModels = vi.mocked(previewRagProviderModels);
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
const fetchMock = vi.fn<typeof fetch>();

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

function createRagTaskSettingsView(role: "admin" | "user"): RagTaskSettingsView {
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

function createHealthSnapshot(withFoundation = true) {
  return {
    status: "ok",
    dependencies: {
      ragIngestionMetrics: {
        foundation: withFoundation
          ? {
              observedBuilds: 5,
              buildSuccessCount: 4,
              buildFailureCount: 1,
              buildSuccessRate: 0.8,
              generatedAt: "2026-04-18T00:00:00.000Z",
              failureReasons: {
                timeout: 1
              },
              activeIndexSummary: {
                total: 1,
                items: [
                  {
                    datasourceId: "ds-orders",
                    indexVersionId: "idx-orders-v2",
                    sourceVersion: "source-v2",
                    activatedAt: "2026-04-18T00:00:00.000Z"
                  }
                ]
              }
            }
          : undefined
      }
    }
  };
}

function createQualityReport(latestRunId?: string): RagQualityGateReport {
  return {
    thresholds: {
      recallAt20Min: 0.7,
      mrrAt10Min: 0.6,
      retrievalRerankP95MsMax: 500,
      degradeRateMax: 0.3,
      minSamples: 10
    },
    sampleSize: 12,
    sampleReady: true,
    gatePass: true,
    reasons: [],
    generatedAt: "2026-04-18T00:00:00.000Z",
    ...(latestRunId
      ? {
          latest: {
            runId: latestRunId,
            datasourceId: "ds-orders",
            recordedAt: "2026-04-18T00:00:00.000Z",
            metrics: {
              recallAt20: 0.82,
              mrrAt10: 0.71,
              retrievalRerankP95Ms: 240,
              degradeRate: 0.05
            }
          }
        }
      : {})
  };
}

function createApiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ status: "success", data }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createRunPayload(runId: string, evidence: Record<string, unknown>) {
  return {
    runId,
    sessionId: "session-1",
    question: "query",
    status: "executionResult",
    provider: "mock-provider",
    trace: {
      runId,
      provider: "mock-provider",
      retryCount: 0,
      steps: []
    },
    delivery: {
      answer: {
        text: "answer",
        status: "executionResult",
        provider: "mock-provider"
      },
      evidence
    },
    createdAt: "2026-04-18T00:00:00.000Z"
  };
}

describe("SettingsPage governance visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/settings");
    mockFetchSupportedProviders.mockResolvedValue([]);
    mockFetchRagTaskConfigs.mockResolvedValue(createRagTaskSettingsView("admin"));
    mockPreviewRagProviderModels.mockResolvedValue({
      provider: "openai",
      supportsModelListing: true,
      recommendedModel: "text-embedding-3-small",
      models: []
    });
    mockUpsertRagTaskConfig.mockResolvedValue(createRagTaskSettingsView("admin").items[0]!);
    mockCheckRagTaskConfigHealth.mockResolvedValue({
      taskType: "embedding",
      status: "healthy",
      reasonCode: "ok",
      message: "ok",
      checkedAt: "2026-04-16T00:00:00.000Z",
      latencyMs: 1,
      configSource: "settings",
      checkedAgainst: "persisted"
    });
    mockFetchBackendHealthSnapshot.mockResolvedValue(createHealthSnapshot());
    mockFetchRagQualityReport.mockResolvedValue(createQualityReport());
    mockFetchRagReplayCompleteness.mockResolvedValue({
      runId: "run-1",
      requiredStages: [],
      observedStages: [],
      missingStages: [],
      completeness: 1,
      ready: true
    });
    mockSubmitRagMemoryFeedback.mockResolvedValue({
      runId: "run-1",
      candidateId: "candidate-1",
      beforeStatus: "candidate",
      afterStatus: "verified",
      applied: true,
      updatedAt: "2026-04-18T00:00:00.000Z"
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
    mockListGlossaryAnchors.mockResolvedValue({
      items: [
        {
          id: "anchor-release-v2",
          scope: "global",
          scopeKey: "global",
          datasourceId: null,
          version: 2,
          anchorType: "release",
          status: "active",
          summary: "release",
          rollbackFromAnchorId: null,
          rollbackReason: null,
          createdByRunId: "run-anchor-release-v2",
          metadata: null,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z"
        },
        {
          id: "anchor-rollback-v1",
          scope: "global",
          scopeKey: "global",
          datasourceId: null,
          version: 1,
          anchorType: "rollback",
          status: "active",
          summary: "rollback",
          rollbackFromAnchorId: "anchor-release-v1",
          rollbackReason: "manual-check",
          createdByRunId: "run-anchor-rollback-v1",
          metadata: null,
          createdAt: "2026-04-18T00:01:00.000Z",
          updatedAt: "2026-04-18T00:01:00.000Z"
        }
      ],
      total: 2,
      page: 1,
      pageSize: 50
    });
    mockCreateGlossaryAnchor.mockResolvedValue({
      anchor: {
        id: "anchor-release-v3",
        scope: "global",
        scopeKey: "global",
        datasourceId: null,
        version: 3,
        anchorType: "release",
        status: "active",
        summary: "release v3",
        rollbackFromAnchorId: null,
        rollbackReason: null,
        createdByRunId: "run-anchor-release-v3",
        metadata: null,
        createdAt: "2026-04-18T00:02:00.000Z",
        updatedAt: "2026-04-18T00:02:00.000Z"
      },
      previousAnchorId: "anchor-release-v2",
      replayed: false,
      idempotencyKey: "idem-create-v3"
    });
    mockRollbackGlossaryAnchor.mockResolvedValue({
      activeAnchor: {
        id: "anchor-rollback-v3",
        scope: "global",
        scopeKey: "global",
        datasourceId: null,
        version: 3,
        anchorType: "rollback",
        status: "active",
        summary: "rollback v3",
        rollbackFromAnchorId: "anchor-release-v3",
        rollbackReason: "manual",
        createdByRunId: "run-anchor-rollback-v3",
        metadata: null,
        createdAt: "2026-04-18T00:03:00.000Z",
        updatedAt: "2026-04-18T00:03:00.000Z"
      },
      previousAnchorId: "anchor-release-v3",
      replayed: false,
      idempotencyKey: "idem-rollback-v3"
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("supports create and rollback actions in users governance section", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    render(<SettingsPage />);

    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "用户列表" }));
    expect(await screen.findByText("术语锚点治理")).toBeInTheDocument();
    expect(screen.getByText(/当前锚点：release · v2 · global/)).toBeInTheDocument();
    expect(screen.getByText(/最近回滚：v1 · from=anchor-release-v1/)).toBeInTheDocument();

    const versionInput = screen.getByLabelText("锚点版本号");
    await user.clear(versionInput);
    await user.type(versionInput, "3");
    await user.click(screen.getByRole("button", { name: "创建锚点" }));

    await waitFor(() => {
      expect(mockCreateGlossaryAnchor).toHaveBeenCalledWith({
        scope: "global",
        version: 3,
        summary: undefined
      });
    });
    expect(await screen.findByText("已创建锚点 anchor-release-v3（v3）")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("回滚目标锚点"), "anchor-release-v2");
    await user.click(screen.getByRole("button", { name: "执行回滚" }));

    await waitFor(() => {
      expect(mockRollbackGlossaryAnchor).toHaveBeenCalledWith({
        scope: "global",
        targetAnchorId: "anchor-release-v2",
        rollbackReason: undefined
      });
    });
    expect(await screen.findByText("回滚完成，当前锚点 anchor-rollback-v3")).toBeInTheDocument();
  });

  it("renders readable 403 error when rollback is forbidden", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    mockRollbackGlossaryAnchor.mockRejectedValueOnce(
      new AdminApiError("仅管理员可执行回滚。", {
        code: "FORBIDDEN"
      })
    );
    render(<SettingsPage />);

    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "用户列表" }));
    await screen.findByText("术语锚点治理");
    await user.click(screen.getByRole("button", { name: "执行回滚" }));

    expect(
      await screen.findByText("无权限（403）：仅管理员可执行回滚。")
    ).toBeInTheDocument();
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

  it("keeps memory feedback writable for admin and readonly for member", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValueOnce(createSettingsView("admin"));
    mockFetchRagQualityReport.mockResolvedValueOnce(createQualityReport("run-admin-1"));
    fetchMock.mockResolvedValueOnce(
      createApiResponse(
        createRunPayload("run-admin-1", {
          runId: "run-admin-1"
        })
      )
    );

    const adminView = render(<SettingsPage />);
    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "RAG 运行" }));
    expect(await screen.findByRole("button", { name: "提交记忆反馈" })).toBeInTheDocument();
    adminView.unmount();

    mockFetchSettingsView.mockResolvedValueOnce(createSettingsView("user"));
    render(<SettingsPage />);
    await screen.findByText("LLM 模型");
    await user.click(screen.getByRole("tab", { name: "RAG 运行" }));
    expect(await screen.findByText("记忆反馈（只读）")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交记忆反馈" })).not.toBeInTheDocument();
  });

  it("shows foundation summary on rag tab", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    render(<SettingsPage />);

    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "RAG 运行" }));

    expect(await screen.findByText("Foundation 状态")).toBeInTheDocument();
    expect(screen.getByText("激活成功")).toBeInTheDocument();
    expect(screen.getByText(/索引版本：idx-orders-v2/)).toBeInTheDocument();
  });

  it("shows glossary anchor governance visibility on rag tab", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    render(<SettingsPage />);

    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "RAG 运行" }));

    expect(await screen.findByText("术语锚点治理")).toBeInTheDocument();
    expect(screen.getByText("当前锚点：release · v2 · global")).toBeInTheDocument();
    expect(
      screen.getByText("最近回滚：v1 · from=anchor-release-v1 · manual-check")
    ).toBeInTheDocument();
    expect(mockListGlossaryAnchors).toHaveBeenCalledWith({
      page: 1,
      pageSize: 50
    });
  });

  it("shows explicit empty state when foundation data is missing", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    mockFetchBackendHealthSnapshot.mockResolvedValue(createHealthSnapshot(false));
    render(<SettingsPage />);

    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "RAG 运行" }));

    expect(await screen.findByText("暂无基础状态数据")).toBeInTheDocument();
  });

  it("shows foundation error without blocking other rag sections", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    mockFetchBackendHealthSnapshot.mockRejectedValue(new Error("health endpoint down"));
    render(<SettingsPage />);

    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "RAG 运行" }));

    expect(
      await screen.findByText("基础状态拉取失败：health endpoint down")
    ).toBeInTheDocument();
    expect(screen.getByText("R2 Gate 报告")).toBeInTheDocument();
    expect(screen.getByText("sampleSize: 12")).toBeInTheDocument();
  });

  it("prioritizes deep-link runId over latest run and shows source label", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/settings?runId=run-deep-link");
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    mockFetchRagQualityReport.mockResolvedValue(createQualityReport("run-latest-fallback"));
    fetchMock.mockResolvedValue(
      createApiResponse(
        createRunPayload("run-deep-link", {
          runId: "run-deep-link",
          semanticVersion: 9,
          semanticLockStatus: "locked"
        })
      )
    );

    render(<SettingsPage />);
    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "RAG 运行" }));

    expect(await screen.findByText("runId: run-deep-link")).toBeInTheDocument();
    expect(screen.getByText("来源：deep-link runId")).toBeInTheDocument();
    expect(screen.getByText("latestRunId: run-latest-fallback")).toBeInTheDocument();
    expect(mockFetchRagReplayCompleteness).toHaveBeenCalledWith("run-deep-link");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/runs/run-deep-link");
  });

  it("falls back to latest run and renders semantic compatibility values", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    mockFetchRagQualityReport.mockResolvedValue(createQualityReport("run-latest-1"));
    fetchMock.mockResolvedValue(
      createApiResponse(
        createRunPayload("run-latest-1", {
          run_id: "run-latest-1",
          semantic_version: 6,
          semantic_lock_status: "degraded",
          semantic_degrade_reason: "semantic_registry_degraded",
          skill_context_summary: {
            skill_count: 2,
            context_count: 5,
            degrade_reason: "context_budget_exceeded"
          }
        })
      )
    );

    render(<SettingsPage />);
    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "RAG 运行" }));

    expect(await screen.findByText("runId: run-latest-1")).toBeInTheDocument();
    expect(screen.getByText("来源：latest run fallback")).toBeInTheDocument();
    expect(screen.getByText("语义版本：6")).toBeInTheDocument();
    expect(screen.getByText("语义锁状态：degraded")).toBeInTheDocument();
    expect(
      screen.getByText("语义降级原因：semantic_registry_degraded")
    ).toBeInTheDocument();
    expect(
      screen.getByText("语义降级标识：已触发（不阻断主链路）")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "技能上下文（只读）：skills=2, context=5, degradeReason=context_budget_exceeded"
      )
    ).toBeInTheDocument();
  });

  it("shows explicit compatibility state when semantic fields are missing", async () => {
    const user = userEvent.setup();
    mockFetchSettingsView.mockResolvedValue(createSettingsView("admin"));
    mockFetchRagQualityReport.mockResolvedValue(createQualityReport("run-missing-semantic"));
    fetchMock.mockResolvedValue(
      createApiResponse(
        createRunPayload("run-missing-semantic", {
          runId: "run-missing-semantic"
        })
      )
    );

    render(<SettingsPage />);
    await screen.findByText("用户列表");
    await user.click(screen.getByRole("tab", { name: "RAG 运行" }));

    expect(await screen.findByText("runId: run-missing-semantic")).toBeInTheDocument();
    expect(screen.getByText("语义版本：版本不可用（字段缺失）")).toBeInTheDocument();
    expect(screen.getByText("语义锁状态：锁状态不可用（字段缺失）")).toBeInTheDocument();
    expect(
      screen.getByText("语义降级原因：未触发（字段缺失或未降级）")
    ).toBeInTheDocument();
    expect(screen.getByText("语义降级标识：未触发")).toBeInTheDocument();
    expect(
      screen.getByText(
        "技能上下文（只读）：skills=0（字段缺失）, context=0（字段缺失）, degradeReason=不可用（字段缺失）"
      )
    ).toBeInTheDocument();
  });
});
