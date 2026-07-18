import { render, screen, waitFor } from "@testing-library/react";
import type { AnalysisGoalContract, AnalysisTaskReadModel } from "@text2sql/shared-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisWorkspace } from "@/components/analysis/analysis-workspace";

const mockList = vi.fn();
const mockGet = vi.fn();
const mockStream = vi.fn();

vi.mock("@/lib/analysis-api-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/analysis-api-client")>();
  return {
    ...original,
    resolveAnalysisWorkspaceId: () => "workspace-1",
    listAnalysisTasks: (...args: unknown[]) => mockList(...args),
    getAnalysisTask: (...args: unknown[]) => mockGet(...args),
    streamAnalysisTaskEvents: (...args: unknown[]) => mockStream(...args),
    commandAnalysisTask: vi.fn(),
    createAnalysisTask: vi.fn(),
    runNextAnalysisWork: vi.fn()
  };
});

const goal: AnalysisGoalContract = {
  version: "analysis-goal.v1",
  objective: "分析订单取消率上升原因",
  decisionUse: "履约策略评审",
  workspaceId: "workspace-1",
  datasourceIds: ["datasource-1"],
  allowedSourceKinds: ["datasource"],
  deliverables: ["报告"],
  budget: { maxDurationMs: 10_000, maxTokenCount: 2_000, maxQueryCount: 10, maxSearchCount: 5, maxArtifactBytes: 20_000 },
  riskLevel: "medium",
  stopConditions: ["budget_exhausted"]
};

const readModel: AnalysisTaskReadModel = {
  task: {
    id: "task-123456789",
    workspaceId: "workspace-1",
    createdByActorId: "user-1",
    status: "running",
    version: 2,
    currentRevisionNumber: 1,
    authorityEpoch: 1,
    goalDigest: "digest",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:01.000Z"
  },
  currentRevision: {
    id: "revision-1",
    taskId: "task-123456789",
    revision: 1,
    status: "active",
    goalContract: goal,
    goalDigest: "digest",
    principalDigest: "principal",
    authPolicyVersion: "v1",
    createdByActorId: "user-1",
    createdAt: "2026-07-17T00:00:00.000Z"
  },
  attempts: [],
  events: [],
  artifacts: [],
  receipts: [],
  manifests: []
};

describe("AnalysisWorkspace", () => {
  beforeEach(() => {
    mockList.mockReset().mockResolvedValue([readModel.task]);
    mockGet.mockReset().mockResolvedValue(readModel);
    mockStream.mockReset().mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
    );
  });

  it("renders the auditable goal, progress, obligations and safe empty evidence state", async () => {
    render(<AnalysisWorkspace />);
    expect(await screen.findByText("分析订单取消率上升原因")).toBeInTheDocument();
    expect(screen.getByText("强制义务")).toBeInTheDocument();
    expect(screen.getByText("尚未提交可见证据。")).toBeInTheDocument();
    expect(screen.getByText("实时同步")).toBeInTheDocument();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith("task-123456789", "workspace-1"));
  });
});
