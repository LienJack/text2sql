import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LlmSettingsView } from "@text2sql/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/settings/page";
import { getRun } from "@/lib/api-client";
import {
  fetchBackendHealthSnapshot,
  fetchRagQualityReport,
  fetchRagReplayCompleteness,
  fetchSettingsView,
  fetchSupportedProviders
} from "@/lib/settings-api-client";
import { createMockRun, createMockRagDelivery } from "../unit/fixtures";

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn()
  };
});

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getRun: vi.fn()
  };
});

vi.mock("@/lib/settings-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings-api-client")>();
  return {
    ...actual,
    fetchSettingsView: vi.fn(),
    fetchSupportedProviders: vi.fn(),
    fetchBackendHealthSnapshot: vi.fn(),
    fetchRagQualityReport: vi.fn(),
    fetchRagReplayCompleteness: vi.fn()
  };
});

const mockGetRun = vi.mocked(getRun);
const mockFetchSettingsView = vi.mocked(fetchSettingsView);
const mockFetchSupportedProviders = vi.mocked(fetchSupportedProviders);
const mockFetchBackendHealthSnapshot = vi.mocked(fetchBackendHealthSnapshot);
const mockFetchRagQualityReport = vi.mocked(fetchRagQualityReport);
const mockFetchRagReplayCompleteness = vi.mocked(fetchRagReplayCompleteness);

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

describe("settings mobile smoke", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 375
    });
    window.dispatchEvent(new Event("resize"));
    window.history.replaceState({}, "", "/settings");

    mockFetchSettingsView.mockResolvedValue(createSettingsView("user"));
    mockFetchSupportedProviders.mockResolvedValue([]);
    mockFetchBackendHealthSnapshot.mockResolvedValue({
      status: "ok",
      dependencies: {
        ragIngestionMetrics: {
          foundation: {
            observedBuilds: 3,
            buildSuccessCount: 3,
            buildFailureCount: 0,
            buildSuccessRate: 1,
            generatedAt: "2026-04-18T00:00:00.000Z",
            failureReasons: {},
            activeIndexSummary: {
              total: 1,
              items: [
                {
                  datasourceId: "ds-orders",
                  indexVersionId: "idx-orders-v3",
                  sourceVersion: "src-v3",
                  activatedAt: "2026-04-18T00:00:00.000Z"
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
      sampleSize: 12,
      sampleReady: true,
      gatePass: true,
      reasons: [],
      generatedAt: "2026-04-18T00:00:00.000Z",
      latest: {
        runId: "run-mobile-1",
        datasourceId: "ds-orders",
        recordedAt: "2026-04-18T00:00:00.000Z",
        metrics: {
          recallAt20: 0.83,
          mrrAt10: 0.71,
          retrievalRerankP95Ms: 240,
          degradeRate: 0.05
        }
      }
    });
    mockFetchRagReplayCompleteness.mockResolvedValue({
      runId: "run-mobile-1",
      requiredStages: [],
      observedStages: [],
      missingStages: [],
      completeness: 1,
      ready: true
    });
    mockGetRun.mockResolvedValue(
      createMockRun({
        runId: "run-mobile-1",
        delivery: createMockRagDelivery("happy", { runId: "run-mobile-1" })
      })
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps rag area usable on 375px without horizontal overflow-prone fixed width controls", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await screen.findByText("LLM 模型");
    await user.click(screen.getByRole("tab", { name: "RAG 运行" }));

    expect(await screen.findByText("Foundation 状态")).toBeInTheDocument();
    expect(screen.getByText("R2 Gate 报告")).toBeInTheDocument();
    expect(screen.getByText("语义与回放概览")).toBeInTheDocument();
    expect(screen.getByText("记忆反馈（只读）")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交记忆反馈" })).not.toBeInTheDocument();

    const ragScrollContainer = document.querySelector(
      "section.min-h-0.flex-1.overflow-auto"
    );
    expect(ragScrollContainer).toBeInTheDocument();
    const hasFixedMinWidthClass = Array.from(
      (ragScrollContainer as HTMLElement).querySelectorAll<HTMLElement>("*")
    ).some((element) => {
      const className =
        typeof element.className === "string" ? element.className : "";
      return className.includes("min-w-[");
    });
    expect(hasFixedMinWidthClass).toBe(false);
  });
});
