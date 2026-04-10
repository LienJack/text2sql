import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@text2sql/shared-types";
import { SessionSidebar } from "@/components/chat/session-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

const sessions: Session[] = [
  {
    id: "session-1",
    datasource: "sqlite_main",
    title: "活跃会话",
    syncStatus: "healthy",
    createdAt: "2026-04-10T00:00:00.000Z"
  },
  {
    id: "session-2",
    datasource: "sqlite_main",
    title: "异常会话",
    syncStatus: "degraded",
    createdAt: "2026-04-10T00:00:01.000Z"
  }
];

describe("SessionSidebar", () => {
  it("renders sessions and supports select / create actions", async () => {
    const user = userEvent.setup();
    const onSelectSession = vi.fn();
    const onCreateSession = vi.fn();

    render(
      <SidebarProvider>
        <SessionSidebar
          sessions={sessions}
          activeSessionId="session-1"
          onSelectSession={onSelectSession}
          onCreateSession={onCreateSession}
          onRenameSession={async () => {}}
          onDeleteSession={async () => {}}
        />
      </SidebarProvider>
    );

    expect(screen.getByText("活跃会话")).toBeInTheDocument();
    expect(screen.getByText("异常会话")).toBeInTheDocument();
    expect(screen.getByText("待同步异常")).toBeInTheDocument();

    await user.click(screen.getByText("异常会话"));
    expect(onSelectSession).toHaveBeenCalledWith("session-2");

    await user.click(screen.getByRole("button", { name: /新建会话/i }));
    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });
});
