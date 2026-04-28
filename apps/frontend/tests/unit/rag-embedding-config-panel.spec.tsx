import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RagEmbeddingConfigPanel } from "@/components/settings/rag-embedding-config-panel";

const baseConfig = {
  id: "rag-embedding",
  taskType: "embedding" as const,
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

describe("RagEmbeddingConfigPanel", () => {
  it("renders admin actions when actor is admin", () => {
    render(
      <RagEmbeddingConfigPanel
        actorRole="admin"
        config={baseConfig}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onHealthCheck={vi.fn().mockResolvedValue({
          taskType: "embedding",
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

    expect(screen.getByRole("button", { name: "保存 Embedding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检测草稿（不保存）" })).toBeInTheDocument();
  });

  it("renders readonly state when actor is user", () => {
    render(
      <RagEmbeddingConfigPanel
        actorRole="user"
        config={baseConfig}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onHealthCheck={vi.fn().mockResolvedValue({
          taskType: "embedding",
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
    expect(screen.queryByRole("button", { name: "保存 Embedding" })).not.toBeInTheDocument();
  });

  it("fills embedding defaults when provider card is selected", async () => {
    const user = userEvent.setup();
    render(
      <RagEmbeddingConfigPanel
        actorRole="admin"
        config={baseConfig}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onHealthCheck={vi.fn().mockResolvedValue({
          taskType: "embedding",
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

    await user.click(screen.getByLabelText("embedding-preset-volcengine"));
    expect(screen.getByLabelText("embedding-provider")).toHaveValue("volcengine");
    expect(screen.getByLabelText("embedding-base-url")).toHaveValue(
      "https://ark.cn-beijing.volces.com/api/v3"
    );
  });

  it("keeps local draft when backend config refreshes while form is dirty", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <RagEmbeddingConfigPanel
        actorRole="admin"
        config={baseConfig}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onHealthCheck={vi.fn().mockResolvedValue({
          taskType: "embedding",
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

    const providerInput = screen.getByLabelText("embedding-provider");
    await user.clear(providerInput);
    await user.type(providerInput, "volcengine");

    rerender(
      <RagEmbeddingConfigPanel
        actorRole="admin"
        config={{
          ...baseConfig,
          provider: "openai",
          updatedAt: "2026-04-17T00:00:00.000Z"
        }}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onHealthCheck={vi.fn().mockResolvedValue({
          taskType: "embedding",
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

    expect(screen.getByLabelText("embedding-provider")).toHaveValue("volcengine");
    expect(
      screen.getByText(
        "检测到后台配置更新，当前草稿已保护。可继续编辑，或点击“重置为最新配置”覆盖草稿。"
      )
    ).toBeInTheDocument();
  });

  it("keeps api key draft when health check fails", async () => {
    const user = userEvent.setup();
    const checkError = vi.fn().mockRejectedValue(new Error("network down"));
    render(
      <RagEmbeddingConfigPanel
        actorRole="admin"
        config={baseConfig}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onHealthCheck={checkError}
      />
    );

    const apiKeyInput = screen.getByLabelText("embedding-api-key");
    await user.type(apiKeyInput, "sk-draft-value");
    await user.click(screen.getByRole("button", { name: "检测草稿（不保存）" }));

    expect(await screen.findByText("network down")).toBeInTheDocument();
    expect(screen.getByLabelText("embedding-api-key")).toHaveValue("sk-draft-value");
  });
});
