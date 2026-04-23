import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelingDeployPanel } from "@/components/settings/modeling/modeling-deploy-panel";
import { precheckWorkspaceModelingDeploy } from "@/lib/admin-api-client";

describe("ModelingDeployPanel", () => {
  it("maps blocking reasons to readable guidance and renders precheck evidence", () => {
    const onPrecheck = vi.fn();
    const onDeploy = vi.fn();

    render(
      <ModelingDeployPanel
        hasUndeployedChanges
        precheck={{
          pass: false,
          riskLevel: "high",
          blockingReasons: ["policy_version_conflict", "dry_run_failed"],
          draftRevision: 3,
          activeRevision: 2,
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
            highRiskStatus: "high",
            unresolvedHighRiskCount: 1,
            unresolvedSchemaChangeIds: ["schema-change:deleted_column:orders:total_amount"]
          }
        }}
        onPrecheck={onPrecheck}
        onDeploy={onDeploy}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Precheck" }));
    expect(onPrecheck).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Activate Revision" })).toBeDisabled();
    expect(
      screen.getByText("policyVersion 已变化，请刷新最新快照并基于新版本重试。")
    ).toBeInTheDocument();
    expect(screen.getByText("Dry-run Failed Samples")).toBeInTheDocument();
    expect(screen.getByText("column_not_found")).toBeInTheDocument();
    expect(
      screen.getByText("schemaChangeId: schema-change:deleted_column:orders:total_amount")
    ).toBeInTheDocument();
  });
});

describe("admin api modeling deploy precheck", () => {
  it("preserves schemaChange payload from backend response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        status: "ok",
        data: {
          workspaceId: "ws-1",
          datasourceId: "ds-1",
          policyVersion: 11,
          draftRevision: 2,
          activeRevision: 1,
          pass: false,
          riskLevel: "high",
          blockingReasons: ["unresolved_schema_changes"],
          dryRun: {
            pass: false,
            executedCount: 1,
            failedSamples: [
              {
                sql: "select total_amount from orders",
                reason: "column_not_found"
              }
            ]
          },
          schemaChange: {
            highRiskStatus: "high",
            unresolvedHighRiskCount: 1,
            unresolvedSchemaChangeIds: [
              "schema-change:deleted_column:orders:total_amount"
            ]
          }
        }
      })
    } as Response);

    const result = await precheckWorkspaceModelingDeploy("ws-1", "ds-1", {
      policyVersion: 11,
      draftRevision: 2
    });

    expect(result.schemaChange).toEqual({
      highRiskStatus: "high",
      unresolvedHighRiskCount: 1,
      unresolvedSchemaChangeIds: ["schema-change:deleted_column:orders:total_amount"]
    });
    expect(result.dryRun.failedSamples[0]?.reason).toBe("column_not_found");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});
