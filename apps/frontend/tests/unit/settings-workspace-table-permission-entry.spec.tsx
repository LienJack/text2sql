import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceDatasourceTablePermissionsDialog } from "@/components/settings/workspace-datasource-table-permissions-dialog";

vi.mock("@/components/settings/workspace-datasource-table-permissions-panel", () => ({
  WorkspaceDatasourceTablePermissionsPanel: ({
    workspaceId,
    fixedDatasourceId,
    fixedDatasourceName,
    hideDatasourceSelector
  }: {
    workspaceId: string;
    fixedDatasourceId?: string;
    fixedDatasourceName?: string;
    hideDatasourceSelector?: boolean;
  }) => (
    <div data-testid="workspace-table-permissions-panel">
      {`${workspaceId}|${fixedDatasourceId}|${fixedDatasourceName}|${String(hideDatasourceSelector)}`}
    </div>
  )
}));

describe("WorkspaceDatasourceTablePermissionsDialog", () => {
  it("passes locked datasource context to permissions panel", async () => {
    render(
      <WorkspaceDatasourceTablePermissionsDialog
        open
        workspaceId="ws-1"
        workspaceName="默认空间"
        datasourceId="sqlite_main"
        datasourceName="SQLite 主数据源"
        onOpenChange={() => undefined}
      />
    );

    expect(screen.getByText("表权限编辑")).toBeInTheDocument();
    expect(
      screen.getByText("工作空间「默认空间」· 数据源「SQLite 主数据源」")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workspace-table-permissions-panel")
    ).toHaveTextContent("ws-1|sqlite_main|SQLite 主数据源|true");
  });

  it("shows idle state when context is missing", async () => {
    render(
      <WorkspaceDatasourceTablePermissionsDialog
        open
        workspaceId="ws-1"
        workspaceName="默认空间"
        datasourceId=""
        datasourceName=""
        onOpenChange={() => undefined}
      />
    );

    expect(
      screen.getByText("缺少工作空间或数据源上下文，暂不可编辑表权限。")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-table-permissions-panel")
    ).not.toBeInTheDocument();
  });
});
