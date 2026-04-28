import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformShell } from "@/components/layout/platform-shell";
import { listWorkspaces } from "@/lib/admin-api-client";

const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname()
}));

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn()
  };
});

const mockListWorkspaces = vi.mocked(listWorkspaces);

describe("PlatformShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePathname.mockReturnValue("/chat");
    window.history.replaceState({}, "", "/chat");
    window.sessionStorage.clear();
    mockListWorkspaces.mockResolvedValue({
      items: [{ id: "ws-default", name: "Default Workspace", isDefault: true }],
      total: 1,
      page: 1,
      pageSize: 200
    });
  });

  it("renders navigation and children", () => {
    render(
      <PlatformShell>
        <div>Child content</div>
      </PlatformShell>
    );

    expect(screen.getByText("text2sql")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Chat/i })).toBeInTheDocument();
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("uses current pathname as title", () => {
    render(
      <PlatformShell>
        <div>Page body</div>
      </PlatformShell>
    );

    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
  });

  it("prefers nested nav item title for modeling path", () => {
    mockUsePathname.mockReturnValue("/modeling");
    render(
      <PlatformShell>
        <div>Modeling page body</div>
      </PlatformShell>
    );

    expect(screen.getByRole("heading", { name: "数据关系图" })).toBeInTheDocument();
  });

  it("does not render workspace modal while checking when there is a single workspace", async () => {
    let resolveWorkspaces:
      | ((value: Awaited<ReturnType<typeof listWorkspaces>>) => void)
      | undefined;
    mockListWorkspaces.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWorkspaces = resolve;
        })
    );

    render(
      <PlatformShell>
        <div>Child content</div>
      </PlatformShell>
    );

    expect(
      screen.queryByRole("heading", { name: "选择工作空间" })
    ).not.toBeInTheDocument();

    resolveWorkspaces?.({
      items: [{ id: "ws-default", name: "Default Workspace", isDefault: true }],
      total: 1,
      page: 1,
      pageSize: 200
    });

    await waitFor(() => {
      expect(window.sessionStorage.getItem("text2sql.activeWorkspaceId")).toBe(
        "ws-default"
      );
    });
    expect(
      screen.queryByRole("heading", { name: "选择工作空间" })
    ).not.toBeInTheDocument();
  });

  it("renders workspace modal when multiple workspaces require manual selection", async () => {
    mockListWorkspaces.mockResolvedValueOnce({
      items: [
        { id: "ws-a", name: "Workspace A", isDefault: true },
        { id: "ws-b", name: "Workspace B", isDefault: false }
      ],
      total: 2,
      page: 1,
      pageSize: 200
    });

    render(
      <PlatformShell>
        <div>Child content</div>
      </PlatformShell>
    );

    expect(
      await screen.findByRole("heading", { name: "选择工作空间" })
    ).toBeInTheDocument();
  });
});
