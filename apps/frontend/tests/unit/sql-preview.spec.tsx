import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SqlPreview } from "@/components/sql-preview";
import { createMockRun } from "./fixtures";

describe("SqlPreview", () => {
  it("renders empty state when run is null", () => {
    render(<SqlPreview run={null} debugEnabled={false} />);
    expect(screen.getByText("暂无 SQL 预览")).toBeInTheDocument();
  });

  it("renders sql summary and result table when run exists", () => {
    render(<SqlPreview run={createMockRun()} debugEnabled />);
    expect(screen.getByText("统计近 30 天支付方式分布。")).toBeInTheDocument();
    expect(
      screen.getByText("SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method")
    ).toBeInTheDocument();
    expect(screen.getByText("执行步骤时间线")).toBeInTheDocument();
    expect(screen.getByText("Provider: mock / Model: mock-model")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "payment_method" })).toBeInTheDocument();
  });

  it("renders error state when run contains error", () => {
    render(
      <SqlPreview run={createMockRun({ error: "SQL 执行失败", llmRaw: null })} debugEnabled />
    );
    expect(screen.getByText("SQL 执行失败")).toBeInTheDocument();
    expect(screen.getByText("该会话无历史原始返回数据。")).toBeInTheDocument();
  });

  it("hides debug details when debug switch is off", () => {
    render(<SqlPreview run={createMockRun()} debugEnabled={false} />);
    expect(screen.getByText("调试详情已关闭。")).toBeInTheDocument();
  });
});
