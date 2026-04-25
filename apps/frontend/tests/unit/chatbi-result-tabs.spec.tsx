import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ChatBIResultTabs,
  type ChatBIResultTabValue
} from "@/components/chat/chatbi-result-tabs";
import { TabsContent } from "@/components/ui/tabs";

function ChatBIResultTabsHarness() {
  const [value, setValue] = useState<ChatBIResultTabValue>("summary");

  return (
    <ChatBIResultTabs value={value} onValueChange={setValue}>
      <TabsContent value="summary">Summary pane</TabsContent>
      <TabsContent value="chart">Chart pane</TabsContent>
      <TabsContent value="table">Table pane</TabsContent>
      <TabsContent value="sql">SQL pane</TabsContent>
    </ChatBIResultTabs>
  );
}

describe("ChatBIResultTabs", () => {
  it("renders four icon tabs and switches sections with click", async () => {
    const user = userEvent.setup();
    render(<ChatBIResultTabsHarness />);

    const summaryTab = screen.getByRole("tab", { name: /summary/i });
    const chartTab = screen.getByRole("tab", { name: /chart/i });
    const tableTab = screen.getByRole("tab", { name: /table/i });
    const sqlTab = screen.getByRole("tab", { name: /SQL 分区/i });

    expect(summaryTab).toHaveAttribute("aria-selected", "true");
    expect(chartTab).toHaveAttribute("aria-selected", "false");
    expect(tableTab).toHaveAttribute("aria-selected", "false");
    expect(sqlTab).toHaveAttribute("aria-selected", "false");

    await user.click(chartTab);
    expect(chartTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Chart pane")).toBeInTheDocument();

    await user.click(sqlTab);
    expect(sqlTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("SQL pane")).toBeInTheDocument();
  });

  it("supports Enter/Space keyboard activation with aria semantics", async () => {
    const user = userEvent.setup();
    render(<ChatBIResultTabsHarness />);

    const tableTab = screen.getByRole("tab", { name: /table/i });
    const sqlTab = screen.getByRole("tab", { name: /SQL 分区/i });

    expect(tableTab).toHaveAttribute("aria-controls");
    expect(sqlTab).toHaveAttribute("aria-controls");

    tableTab.focus();
    await user.keyboard("{Enter}");
    expect(tableTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Table pane")).toBeInTheDocument();

    sqlTab.focus();
    await user.keyboard("[Space]");
    expect(sqlTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("SQL pane")).toBeInTheDocument();
  });
});
