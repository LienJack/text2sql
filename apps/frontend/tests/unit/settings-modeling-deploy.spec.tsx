import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelingWorkspacePage from "@/app/settings/modeling/page";
import {
  deployWorkspaceModeling,
  getWorkspaceModelingGraph,
  listWorkspaceDatasourceBindings,
  listWorkspaceDatasourceTablePermissions,
  listWorkspaces,
  precheckWorkspaceModelingDeploy
} from "@/lib/admin-api-client";

vi.mock("@/lib/admin-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-api-client")>();
  return {
    ...actual,
    listWorkspaces: vi.fn(),
    listWorkspaceDatasourceBindings: vi.fn(),
    listWorkspaceDatasourceTablePermissions: vi.fn(),
    getWorkspaceModelingGraph: vi.fn(),
    precheckWorkspaceModelingDeploy: vi.fn(),
    deployWorkspaceModeling: vi.fn()
  };
});

const mockListWorkspaces = vi.mocked(listWorkspaces);
const mockListWorkspaceDatasourceBindings = vi.mocked(listWorkspaceDatasourceBindings);
const mockListWorkspaceDatasourceTablePermissions = vi.mocked(
  listWorkspaceDatasourceTablePermissions
);
const mockGetWorkspaceModelingGraph = vi.mocked(getWorkspaceModelingGraph);
const mockPrecheckWorkspaceModelingDeploy = vi.mocked(precheckWorkspaceModelingDeploy);
const mockDeployWorkspaceModeling = vi.mocked(deployWorkspaceModeling);

describe("settings modeling deploy flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/settings/modeling?workspaceId=ws-1&datasourceId=ds-1");

    mockListWorkspaces.mockResolvedValue({
      items: [{ id: "ws-1", name: "Workspace 1", isDefault: true }],
      total: 1,
      page: 1,
      pageSize: 200
    });
    mockListWorkspaceDatasourceBindings.mockResolvedValue([
      {
        id: "binding-1",
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        datasourceName: "Datasource 1",
        createdAt: "2026-04-23T00:00:00.000Z",
        updatedAt: "2026-04-23T00:00:00.000Z"
      }
    ]);
    mockListWorkspaceDatasourceTablePermissions.mockResolvedValue({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      tableNames: ["orders"],
      policyVersion: 11
    });
  });

  it("shows policy_version_conflict guidance and dry-run failure details", async () => {
    const user = userEvent.setup();
    mockGetWorkspaceModelingGraph.mockResolvedValue({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      activeRevision: 1,
      draft: {
        policyVersion: 11,
        revision: 2,
        graphHash: "hash-r2",
        updatedAt: "2026-04-23T00:00:00.000Z",
        graphPayload: {
          models: [],
          relationships: [],
          calculatedFields: [],
          views: [],
          schemaChanges: []
        }
      }
    });
    mockPrecheckWorkspaceModelingDeploy.mockResolvedValue({
      stage: "modeling_deploy_precheck_completed",
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      policyVersion: 11,
      draftRevision: 2,
      activeRevision: 1,
      pass: false,
      riskLevel: "high",
      blockingReasons: ["policy_version_conflict", "dry_run_failed"],
      dryRun: {
        pass: false,
        executedCount: 2,
        failedSamples: [
          {
            reason: "column_not_found",
            sql: "select total_amount from orders"
          }
        ]
      },
      schemaChange: {
        highRiskStatus: "low",
        unresolvedHighRiskCount: 0,
        unresolvedSchemaChangeIds: []
      }
    });

    render(<ModelingWorkspacePage />);
    await screen.findByText("Deploy");

    await user.click(screen.getByRole("button", { name: "Precheck" }));

    expect(await screen.findByText("Deploy precheck 未通过，请先处理阻断项。")).toBeInTheDocument();
    expect(
      screen.getByText("policyVersion 已变化，请刷新最新快照并基于新版本重试。")
    ).toBeInTheDocument();
    expect(screen.getByText("Dry-run Failed Samples")).toBeInTheDocument();
    expect(screen.getByText("column_not_found")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Activate Revision" })
    ).toBeDisabled();
  });

  it("syncs deploy success evidence after activate revision", async () => {
    const user = userEvent.setup();
    let graphCall = 0;
    mockGetWorkspaceModelingGraph.mockImplementation(async () => {
      graphCall += 1;
      if (graphCall === 1) {
        return {
          workspaceId: "ws-1",
          datasourceId: "ds-1",
          activeRevision: 1,
          draft: {
            policyVersion: 11,
            revision: 2,
            graphHash: "hash-r2",
            updatedAt: "2026-04-23T00:00:00.000Z",
            graphPayload: {
              models: [],
              relationships: [],
              calculatedFields: [],
              views: [],
              schemaChanges: []
            }
          }
        };
      }
      return {
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 2,
        draft: {
          policyVersion: 11,
          revision: 2,
          graphHash: "hash-r2",
          updatedAt: "2026-04-23T00:02:00.000Z",
          graphPayload: {
            models: [],
            relationships: [],
            calculatedFields: [],
            views: [],
            schemaChanges: []
          }
        }
      };
    });
    mockPrecheckWorkspaceModelingDeploy.mockResolvedValue({
      stage: "modeling_deploy_precheck_completed",
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      policyVersion: 11,
      draftRevision: 2,
      activeRevision: 1,
      pass: true,
      riskLevel: "low",
      blockingReasons: [],
      dryRun: {
        pass: true,
        executedCount: 2,
        failedSamples: []
      },
      schemaChange: {
        highRiskStatus: "low",
        unresolvedHighRiskCount: 0,
        unresolvedSchemaChangeIds: []
      }
    });
    mockDeployWorkspaceModeling.mockResolvedValue({
      stage: "modeling_deployed",
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      activeRevision: 2,
      graphHash: "hash-r2",
      blockingReasons: []
    });

    render(<ModelingWorkspacePage />);
    await screen.findByText("Deploy");

    await user.click(screen.getByRole("button", { name: "Precheck" }));
    expect(await screen.findByText("Deploy precheck 通过。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Activate Revision" }));
    expect(await screen.findByText("Modeling revision 已激活。")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Draft Revision: 2")).toBeInTheDocument();
      expect(screen.getByText("Active Revision: 2")).toBeInTheDocument();
      expect(
        screen.getByText("当前无已保存但未部署的 revision 差异。")
      ).toBeInTheDocument();
    });
  });
});
