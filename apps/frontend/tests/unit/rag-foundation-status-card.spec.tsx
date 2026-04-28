import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RagFoundationStatusCard } from "@/components/chat/rag-foundation-status-card";

describe("RagFoundationStatusCard", () => {
  it("shows explicit empty state when foundation snapshot is missing", () => {
    render(<RagFoundationStatusCard foundation={null} />);
    expect(screen.getByText("暂无基础状态数据")).toBeInTheDocument();
  });

  it("shows non-blocking error block when loading foundation fails", () => {
    render(
      <RagFoundationStatusCard
        foundation={null}
        error="network timeout"
      />
    );
    expect(
      screen.getByText("基础状态拉取失败：network timeout")
    ).toBeInTheDocument();
  });

  it("renders index, activation, build and rollback summary", () => {
    render(
      <RagFoundationStatusCard
        foundation={{
          observedBuilds: 6,
          buildSuccessCount: 4,
          buildFailureCount: 2,
          buildSuccessRate: 4 / 6,
          generatedAt: "2026-04-18T10:00:00.000Z",
          failureReasons: {
            rollback_applied: 1
          },
          activeIndexSummary: {
            total: 1,
            items: [
              {
                datasourceId: "ds-sales",
                indexVersionId: "idx-sales-v3",
                sourceVersion: "source-v3",
                activatedAt: "2026-04-18T09:00:00.000Z"
              }
            ]
          }
        }}
      />
    );

    expect(screen.getByText("激活成功")).toBeInTheDocument();
    expect(screen.getByText("部分成功")).toBeInTheDocument();
    expect(screen.getByText("已回滚")).toBeInTheDocument();
    expect(screen.getByText(/索引版本：idx-sales-v3/)).toBeInTheDocument();
    expect(screen.getByText(/回滚相关：已回滚/)).toBeInTheDocument();
  });
});
