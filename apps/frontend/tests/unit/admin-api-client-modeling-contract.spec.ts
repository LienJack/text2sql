import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWorkspaceModelingGraph,
  precheckWorkspaceModelingDeploy
} from "@/lib/admin-api-client";

describe("admin-api-client modeling contract parity", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("normalizes modeling snapshot revisionSummary and node section groups", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "ok",
          data: {
            workspaceId: "ws-1",
            datasourceId: "ds-1",
            activeRevision: 2,
            revisionSummary: {
              draftRevision: 3,
              activeRevision: 2,
              deployState: "undeployed"
            },
            draft: {
              policyVersion: 7,
              revision: 3,
              graphHash: "hash-r3",
              updatedAt: "2026-04-24T00:00:00.000Z",
              graphPayload: {
                models: [
                  {
                    id: "model.orders",
                    tableName: "orders",
                    modelName: "orders",
                    columns: [{ name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true }]
                  }
                ],
                relationships: [
                  {
                    id: "rel-orders-customers",
                    source: "manual",
                    confidence: 0.9,
                    bridge: {
                      left: { dataset: "analytics", table: "orders", column: "customer_id" },
                      right: { dataset: "analytics", table: "customers", column: "id" },
                      operator: "eq",
                      confidence: 0.9
                    }
                  }
                ],
                calculatedFields: [
                  {
                    id: "cf-total",
                    modelId: "model.orders",
                    name: "total",
                    expression: "sum(amount)",
                    dataType: "numeric"
                  }
                ],
                views: [],
                schemaChanges: []
              }
            }
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    ) as typeof fetch;

    const snapshot = await getWorkspaceModelingGraph("ws-1", "ds-1");
    expect(snapshot.revisionSummary).toEqual({
      draftRevision: 3,
      activeRevision: 2,
      deployState: "undeployed"
    });
    expect(snapshot.draft?.graphPayload.models[0]?.nodeSections).toEqual({
      columns: ["id"],
      calculatedFields: ["cf-total"],
      relationships: ["rel-orders-customers"]
    });
  });

  it("accepts targetRevision alias for deploy precheck payload parity", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "ok",
          data: {
            stage: "modeling_deploy_precheck_completed",
            workspaceId: "ws-1",
            datasourceId: "ds-1",
            policyVersion: 7,
            targetRevision: 5,
            activeRevision: 4,
            deployState: "undeployed",
            pass: true,
            riskLevel: "low",
            blockingReasons: [],
            dryRun: {
              pass: true,
              executedCount: 1,
              failedSamples: []
            },
            schemaChange: {
              highRiskStatus: "low",
              unresolvedHighRiskCount: 0,
              unresolvedSchemaChangeIds: []
            }
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    ) as typeof fetch;

    const result = await precheckWorkspaceModelingDeploy("ws-1", "ds-1", {
      policyVersion: 7,
      targetRevision: 5
    });
    expect(result.draftRevision).toBe(5);
    expect(result.revisionSummary).toEqual({
      draftRevision: 5,
      activeRevision: 4,
      deployState: "undeployed"
    });
  });
});
