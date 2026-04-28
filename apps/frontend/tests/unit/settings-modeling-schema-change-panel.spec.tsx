import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ModelingSchemaChangePanel,
  type ModelingSchemaChangeItem
} from "@/components/settings/modeling/modeling-schema-change-panel";
import { detectWorkspaceModelingSchemaChanges } from "@/lib/admin-api-client";

describe("ModelingSchemaChangePanel", () => {
  it("renders grouped deleted/modified sections with impact and residual summary", () => {
    const onDetect = vi.fn();
    const onResolve = vi.fn();
    const items: ModelingSchemaChangeItem[] = [
      {
        id: "schema-change:deleted_table:legacy_orders",
        kind: "deleted_table",
        status: "detected",
        summary: "legacy_orders 表已删除"
      },
      {
        id: "schema-change:deleted_column:orders:total_amount",
        kind: "deleted_column",
        status: "detected",
        summary: "orders.total_amount 已删除"
      },
      {
        id: "schema-change:modified_column_type:orders:status",
        kind: "modified_column_type",
        status: "resolved",
        summary: "orders.status 类型从 int 变更为 text"
      }
    ];

    render(
      <ModelingSchemaChangePanel
        items={items}
        unresolvedCount={2}
        onDetect={onDetect}
        onResolve={onResolve}
      />
    );

    expect(screen.getByText("Impact Summary")).toBeInTheDocument();
    expect(screen.getByText("Deleted (2)")).toBeInTheDocument();
    expect(screen.getByText("Modified (1)")).toBeInTheDocument();
    expect(screen.getByText("仍有 2 项待处理")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Detect" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Resolve" })[0]);

    expect(onDetect).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith("schema-change:deleted_table:legacy_orders");
    expect(
      screen.getByText("orders.status 类型从 int 变更为 text")
    ).toBeInTheDocument();
  });
});

describe("admin api modeling schema change detect", () => {
  it("preserves grouped detect shape while exposing flattened list", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        status: "ok",
        data: {
          workspaceId: "ws-1",
          datasourceId: "ds-1",
          policyVersion: 5,
          unresolvedHighRiskCount: 2,
          highRiskStatus: "high",
          changes: {
            deletedTables: [
              {
                id: "schema-change:deleted_table:legacy_orders",
                status: "detected",
                summary: "legacy_orders 表已删除"
              }
            ],
            deletedColumns: [
              {
                id: "schema-change:deleted_column:orders:total_amount",
                kind: "deleted_column",
                status: "detected",
                summary: "orders.total_amount 已删除"
              }
            ],
            modifiedColumns: [],
            other: []
          }
        }
      })
    } as Response);

    const result = await detectWorkspaceModelingSchemaChanges("ws-1", "ds-1", {
      policyVersion: 5
    });

    expect(result.groupedChanges.deletedTables).toEqual([
      expect.objectContaining({
        id: "schema-change:deleted_table:legacy_orders",
        kind: "deleted_table"
      })
    ]);
    expect(result.groupedChanges.deletedColumns).toEqual([
      expect.objectContaining({
        id: "schema-change:deleted_column:orders:total_amount",
        kind: "deleted_column"
      })
    ]);
    expect(result.changes).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});
