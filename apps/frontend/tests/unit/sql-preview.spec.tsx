import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SqlPreview } from "@/components/sql-preview";
import { createMockRun } from "./fixtures";

describe("SqlPreview", () => {
  it("renders empty state when run is null", () => {
    render(<SqlPreview run={null} />);
    expect(screen.getByText("暂无 SQL 预览")).toBeInTheDocument();
  });

  it("renders sql summary and result table when run exists", () => {
    render(<SqlPreview run={createMockRun()} />);
    expect(screen.getByText("统计近 30 天支付方式分布。")).toBeInTheDocument();
    expect(
      screen.getByText("SELECT payment_method, COUNT(*) AS cnt FROM orders GROUP BY payment_method")
    ).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "payment_method" })).toBeInTheDocument();
  });

  it("renders error state when run contains error", () => {
    render(<SqlPreview run={createMockRun({ error: "SQL 执行失败" })} />);
    expect(screen.getByText("SQL 执行失败")).toBeInTheDocument();
  });
});
