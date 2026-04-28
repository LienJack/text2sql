import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RagRerankConfigPanel } from "@/components/settings/rag-rerank-config-panel";

const baseConfig = {
  id: "rag-rerank",
  taskType: "rerank" as const,
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
  healthStatus: "unknown" as const,
  lastCheckedAt: null,
  lastHealthLatencyMs: null,
  lastHealthMessage: null,
  lastError: null,
  configSource: "settings" as const,
  configSourceNote: null,
  createdAt: "2026-04-16T00:00:00.000Z",
  updatedAt: "2026-04-16T00:00:00.000Z"
};

describe("RagRerankConfigPanel", () => {
  it("renders admin entry actions when actor is admin", () => {
    render(
      <RagRerankConfigPanel
        actorRole="admin"
        config={baseConfig}
        onFetchModels={vi.fn().mockResolvedValue({ provider: "openai", supportsModelListing: true, models: [] })}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onHealthCheck={vi.fn().mockResolvedValue({
          taskType: "rerank",
          status: "healthy",
          reasonCode: "ok",
          message: "ok",
          checkedAt: "2026-04-16T00:00:00.000Z",
          latencyMs: 1,
          configSource: "settings",
          checkedAgainst: "persisted"
        })}
      />
    );

    expect(screen.getByRole("button", { name: "编辑当前草稿" })).toBeInTheDocument();
    expect(screen.getByText("Rerank Provider")).toBeInTheDocument();
  });

  it("renders readonly state when actor is user", () => {
    render(
      <RagRerankConfigPanel
        actorRole="user"
        config={baseConfig}
        onFetchModels={vi.fn().mockResolvedValue({ provider: "openai", supportsModelListing: true, models: [] })}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onHealthCheck={vi.fn().mockResolvedValue({
          taskType: "rerank",
          status: "healthy",
          reasonCode: "ok",
          message: "ok",
          checkedAt: "2026-04-16T00:00:00.000Z",
          latencyMs: 1,
          configSource: "settings",
          checkedAgainst: "persisted"
        })}
      />
    );

    expect(screen.getByText("当前账号只读，可查看配置摘要。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存 Rerank" })).not.toBeInTheDocument();
  });

  it("fills rerank defaults in dialog when provider card is selected", async () => {
    const user = userEvent.setup();
    render(
      <RagRerankConfigPanel
        actorRole="admin"
        config={baseConfig}
        onFetchModels={vi.fn().mockResolvedValue({ provider: "siliconflow", supportsModelListing: true, models: [] })}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onHealthCheck={vi.fn().mockResolvedValue({
          taskType: "rerank",
          status: "healthy",
          reasonCode: "ok",
          message: "ok",
          checkedAt: "2026-04-16T00:00:00.000Z",
          latencyMs: 1,
          configSource: "settings",
          checkedAgainst: "persisted"
        })}
      />
    );

    await user.click(screen.getByLabelText("rerank-preset-siliconflow"));
    expect(await screen.findByText("配置 Rerank: 硅基流动")).toBeInTheDocument();
    expect(screen.getByText("siliconflow")).toBeInTheDocument();
    expect(screen.getByLabelText("rerank-base-url")).toHaveValue(
      "https://api.siliconflow.cn/v1"
    );
  });

  it("keeps local rerank draft when backend config refreshes while dirty", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <RagRerankConfigPanel
        actorRole="admin"
        config={baseConfig}
        onFetchModels={vi.fn().mockResolvedValue({ provider: "openai", supportsModelListing: true, models: [] })}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onHealthCheck={vi.fn().mockResolvedValue({
          taskType: "rerank",
          status: "healthy",
          reasonCode: "ok",
          message: "ok",
          checkedAt: "2026-04-16T00:00:00.000Z",
          latencyMs: 1,
          configSource: "settings",
          checkedAgainst: "persisted"
        })}
      />
    );

    await user.click(screen.getByRole("button", { name: "编辑当前草稿" }));

    const modelInput = await screen.findByLabelText("rerank-model");
    await user.clear(modelInput);
    await user.type(modelInput, "bge-reranker-v2-m3");

    rerender(
      <RagRerankConfigPanel
        actorRole="admin"
        config={{
          ...baseConfig,
          model: "old-model",
          updatedAt: "2026-04-17T00:00:00.000Z"
        }}
        onFetchModels={vi.fn().mockResolvedValue({ provider: "openai", supportsModelListing: true, models: [] })}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onHealthCheck={vi.fn().mockResolvedValue({
          taskType: "rerank",
          status: "healthy",
          reasonCode: "ok",
          message: "ok",
          checkedAt: "2026-04-16T00:00:00.000Z",
          latencyMs: 1,
          configSource: "settings",
          checkedAgainst: "persisted"
        })}
      />
    );

    expect(screen.getByLabelText("rerank-model")).toHaveValue("bge-reranker-v2-m3");
    expect(
      screen.getByText(
        "检测到后台配置更新，当前草稿已保护。可继续编辑，或在弹窗里重置为最新配置。"
      )
    ).toBeInTheDocument();
  });
});
