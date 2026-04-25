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
  const [value, setValue] = useState<ChatBIResultTabValue>("answer");

  return (
    <ChatBIResultTabs value={value} onValueChange={setValue}>
      <TabsContent value="answer">Answer pane</TabsContent>
      <TabsContent value="chart">Chart pane</TabsContent>
      <TabsContent value="sql">SQL pane</TabsContent>
    </ChatBIResultTabs>
  );
}

describe("ChatBIResultTabs", () => {
  it("renders Answer/View SQL/Chart tabs and switches sections with click", async () => {
    const user = userEvent.setup();
    render(<ChatBIResultTabsHarness />);

    const answerTab = screen.getByRole("tab", { name: /answer/i });
    const sqlTab = screen.getByRole("tab", { name: /view sql/i });
    const chartTab = screen.getByRole("tab", { name: /chart/i });

    expect(answerTab).toHaveAttribute("aria-selected", "true");
    expect(sqlTab).toHaveAttribute("aria-selected", "false");
    expect(chartTab).toHaveAttribute("aria-selected", "false");

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

    const chartTab = screen.getByRole("tab", { name: /chart/i });
    const sqlTab = screen.getByRole("tab", { name: /view sql/i });

    expect(chartTab).toHaveAttribute("aria-controls");
    expect(sqlTab).toHaveAttribute("aria-controls");

    chartTab.focus();
    await user.keyboard("{Enter}");
    expect(chartTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Chart pane")).toBeInTheDocument();

    sqlTab.focus();
    await user.keyboard("[Space]");
    expect(sqlTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("SQL pane")).toBeInTheDocument();
  });
});
