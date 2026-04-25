import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ChatBIResultPanel } from "@/components/chat/chatbi-result-panel";
import { createMockRun } from "./fixtures";

describe("ChatBIResultPanel", () => {
  it("supports Summary/Chart/Table/SQL partition switching and keeps SQL quick entry secondary", async () => {
    const user = userEvent.setup();
    const onRequestSqlDetails = vi.fn();

    const run = createMockRun({
      delivery: {
        answer: {
          text: "近三个月收入持续增长。",
          status: "executionResult",
          provider: "mock"
        },
        artifact: {
          sql: "select month, revenue from revenue_monthly",
          rowCount: 3,
          hasError: false,
          summary: {
            headline: "增长稳定",
            text: "近三个月收入持续增长。"
          },
          table: {
            columns: ["month", "revenue"],
            rowCount: 3,
            rowsPreview: [
              { month: "2026-01", revenue: 100 },
              { month: "2026-02", revenue: 120 },
              { month: "2026-03", revenue: 140 }
            ],
            previewRowCount: 3
          },
          chart: {
            type: "bar",
            mappings: {
              x: "month",
              y: "revenue"
            },
            meta: {
              title: "月度收入"
            }
          },
          display: "bar",
          validation: {
            status: "valid"
          },
          visualIntent: {
            source: "model",
            rawSyntax: "<script>alert('xss')</script>"
          }
        }
      }
    });

    render(
      <ChatBIResultPanel
        run={run}
        streamDelivery={undefined}
        runId={run.runId}
        onRequestSqlDetails={onRequestSqlDetails}
      />
    );

    const summaryTab = screen.getByRole("tab", { name: /summary/i });
    const chartTab = screen.getByRole("tab", { name: /chart/i });
    const tableTab = screen.getByRole("tab", { name: /table/i });
    const sqlTab = screen.getByRole("tab", { name: /SQL 分区/i });

    expect(summaryTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("近三个月收入持续增长。")).toBeInTheDocument();
    expect(screen.queryByText(/xss/i)).not.toBeInTheDocument();

    await user.click(chartTab);
    expect(chartTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("chatbi-bar-chart")).toBeInTheDocument();

    await user.click(tableTab);
    expect(screen.getByRole("columnheader", { name: "month" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "revenue" })).toBeInTheDocument();

    await user.click(sqlTab);
    expect(sqlTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/SQL 为次级证据层/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开运行详情" }));
    expect(onRequestSqlDetails).toHaveBeenCalledTimes(1);
  });

  it("renders metric chart for metric artifacts", async () => {
    const user = userEvent.setup();
    const run = createMockRun({
      delivery: {
        answer: {
          text: "本月 GMV 为 12,340。",
          status: "executionResult",
          provider: "mock"
        },
        artifact: {
          rowCount: 1,
          hasError: false,
          summary: {
            text: "本月 GMV 为 12,340。"
          },
          table: {
            columns: ["label", "value"],
            rowCount: 1,
            rowsPreview: [{ label: "GMV", value: 12340 }],
            previewRowCount: 1
          },
          chart: {
            type: "metric",
            mappings: {
              label: "label",
              value: "value"
            },
            meta: {
              title: "核心指标",
              unit: "元"
            }
          },
          display: "metric",
          validation: {
            status: "valid"
          }
        }
      }
    });

    render(<ChatBIResultPanel run={run} runId={run.runId} />);

    await user.click(screen.getByRole("tab", { name: /chart/i }));
    expect(screen.getByTestId("chatbi-metric-card")).toBeInTheDocument();
    expect(screen.getByText("12,340")).toBeInTheDocument();
    expect(screen.getByText("元")).toBeInTheDocument();
  });

  it("shows readable downgrade notice and skips empty chart render for table fallback", async () => {
    const user = userEvent.setup();
    const run = createMockRun({
      delivery: {
        answer: {
          text: "结果已按表格展示。",
          status: "executionResult",
          provider: "mock"
        },
        artifact: {
          rowCount: 2,
          hasError: false,
          table: {
            columns: ["region", "revenue"],
            rowCount: 2,
            rowsPreview: [
              { region: "JP", revenue: 100 },
              { region: "US", revenue: 80 }
            ],
            previewRowCount: 2
          },
          chart: {
            type: "bar",
            mappings: {
              x: "region",
              y: "revenue"
            }
          },
          display: "table",
          fallback: {
            display: "table",
            reason: "字段稀疏，不满足图表渲染条件",
            fromType: "bar"
          },
          validation: {
            status: "fallback"
          }
        }
      }
    });

    render(<ChatBIResultPanel run={run} runId={run.runId} />);

    await user.click(screen.getByRole("tab", { name: /chart/i }));
    expect(screen.getByText(/图表已降级为表格/i)).toBeInTheDocument();
    expect(screen.queryByTestId("chatbi-chart-canvas")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看 Table 分区" }));
    expect(screen.getByRole("columnheader", { name: "region" })).toBeInTheDocument();
  });
});
