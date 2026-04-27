import { render, screen } from "@testing-library/react";
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
          configSource: "settings"
        })}
      />
    );

    expect(screen.getByRole("button", { name: "保存 Embedding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查连通性" })).toBeInTheDocument();
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
          configSource: "settings"
        })}
      />
    );

    expect(screen.getByText("当前账号只读，可查看配置摘要。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存 Embedding" })).not.toBeInTheDocument();
  });
});
