import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SaveAsViewDialog } from "@/components/chat/save-as-view-dialog";
import { saveModelingViewFromRun } from "@/lib/admin-api-client";

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    saveModelingViewFromRun: vi.fn()
  };
});

const mockSaveModelingViewFromRun = vi.mocked(saveModelingViewFromRun);

describe("chat save-as-view dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits run view save and surfaces success state", async () => {
    const user = userEvent.setup();
    mockSaveModelingViewFromRun.mockResolvedValue({
      stage: "chat_run_view_saved",
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      runId: "run-1",
      replayed: false,
      activeRevision: 1,
      draftRevision: 2,
      view: {
        id: "view.chat_run.run-1",
        name: "orders_recent_10",
        sql: "SELECT * FROM orders LIMIT 10",
        displayName: "Orders Recent 10",
        description: "Saved from run"
      }
    });

    render(
      <SaveAsViewDialog
        open
        onOpenChange={() => undefined}
        workspaceId="ws-1"
        datasourceId="ds-1"
        runId="run-1"
      />
    );

    await user.clear(screen.getByLabelText("View 名称"));
    await user.type(screen.getByLabelText("View 名称"), "orders_recent_10");
    await user.click(screen.getByRole("button", { name: "保存为 View" }));

    await waitFor(() => {
      expect(mockSaveModelingViewFromRun).toHaveBeenCalledWith("ws-1", "ds-1", {
        runId: "run-1",
        name: "orders_recent_10",
        displayName: expect.any(String),
        description: ""
      });
    });
    expect(screen.getByText(/保存成功：orders_recent_10/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "前往 Modeling" })
    ).toBeInTheDocument();
  });

  it("keeps user input after conflict error for retry", async () => {
    const user = userEvent.setup();
    mockSaveModelingViewFromRun.mockRejectedValueOnce(
      new Error("视图名称已存在，请更换名称后重试。")
    );
    mockSaveModelingViewFromRun.mockResolvedValueOnce({
      stage: "chat_run_view_saved",
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      runId: "run-1",
      replayed: false,
      activeRevision: 1,
      draftRevision: 3,
      view: {
        id: "view.chat_run.run-1",
        name: "orders_recent_10_v2",
        sql: "SELECT * FROM orders LIMIT 10",
        displayName: "Orders Recent 10 V2",
        description: "Saved from run"
      }
    });

    render(
      <SaveAsViewDialog
        open
        onOpenChange={() => undefined}
        workspaceId="ws-1"
        datasourceId="ds-1"
        runId="run-1"
      />
    );

    const nameInput = screen.getByLabelText("View 名称");
    await user.clear(nameInput);
    await user.type(nameInput, "orders_recent_10");
    await user.click(screen.getByRole("button", { name: "保存为 View" }));

    expect(await screen.findByText("视图名称已存在，请更换名称后重试。")).toBeInTheDocument();
    expect(screen.getByLabelText("View 名称")).toHaveValue("orders_recent_10");

    await user.clear(screen.getByLabelText("View 名称"));
    await user.type(screen.getByLabelText("View 名称"), "orders_recent_10_v2");
    await user.click(screen.getByRole("button", { name: "保存为 View" }));

    await waitFor(() => {
      expect(mockSaveModelingViewFromRun).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText(/保存成功：orders_recent_10_v2/)).toBeInTheDocument();
  });

  it("syncs modeling selection signal when navigating after save", async () => {
    const user = userEvent.setup();
    const originalLocation = window.location;
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        assign: assignSpy
      }
    });

    mockSaveModelingViewFromRun.mockResolvedValueOnce({
      stage: "chat_run_view_saved",
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      runId: "run-1",
      replayed: false,
      activeRevision: 1,
      draftRevision: 2,
      view: {
        id: "view.chat_run.run-1",
        name: "orders_recent_10",
        sql: "SELECT * FROM orders LIMIT 10",
        displayName: "Orders Recent 10",
        description: "Saved from run"
      }
    });

    render(
      <SaveAsViewDialog
        open
        onOpenChange={() => undefined}
        workspaceId="ws-1"
        datasourceId="ds-1"
        runId="run-1"
      />
    );

    await user.clear(screen.getByLabelText("View 名称"));
    await user.type(screen.getByLabelText("View 名称"), "orders_recent_10");
    await user.click(screen.getByRole("button", { name: "保存为 View" }));
    await user.click(await screen.findByRole("button", { name: "前往 Modeling" }));

    expect(window.sessionStorage.getItem("text2sql.modeling.selectViewId")).toBe(
      "view.chat_run.run-1"
    );
    expect(assignSpy).toHaveBeenCalledWith(
      "/settings/modeling?workspaceId=ws-1&datasourceId=ds-1&viewId=view.chat_run.run-1"
    );

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation
    });
  });
});
