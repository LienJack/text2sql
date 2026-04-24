import { WorkspaceRelationshipService } from "../../src/modules/governance/workspace/workspace-relationship.service";

const actor = {
  id: "user-admin",
  role: "admin" as const
};

const edgePayload = [
  {
    id: "edge-orders-customers",
    name: "orders_to_customers",
    bridge: {
      left: {
        dataset: "sales",
        table: "orders",
        column: "customer_id"
      },
      right: {
        dataset: "crm",
        table: "customers",
        column: "id"
      },
      operator: "eq" as const,
      confidence: 0.86
    }
  }
];

describe("workspace relationship api service integration", () => {
  const buildService = (options?: {
    gatePass?: boolean;
    bound?: boolean;
    policyVersion?: number;
  }) => {
    const workspaceRepository = {
      getWorkspaceById: async () => ({
        id: "ws-1",
        status: "active"
      }),
      isWorkspaceAdmin: async () => true
    };
    const datasourceRepository = {
      getDatasourceById: async () => ({
        id: "ds-1",
        status: "available"
      })
    };
    const policyRepository = {
      isDatasourceBound: async () => options?.bound ?? true,
      getWorkspaceDatasourceTablePermissionSet: async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        policyVersion: options?.policyVersion ?? 3,
        tableNames: ["customers", "orders", "products"]
      })
    };
    const auditLogRepository = {
      appendEvent: async () => undefined
    };
    const publishGateFacade = {
      evaluate: async () => ({
        pass: options?.gatePass ?? true,
        riskLevel: "low" as const,
        blockingReasons: options?.gatePass === false ? ["dry_run_failed"] : [],
        dryRun: {
          pass: options?.gatePass ?? true,
          executedCount: 1,
          failedSamples:
            options?.gatePass === false
              ? [{ sql: "select 1", reason: "dry run failed" }]
              : []
        }
      })
    };

    return new WorkspaceRelationshipService(
      workspaceRepository as never,
      datasourceRepository as never,
      policyRepository as never,
      auditLogRepository as never,
      publishGateFacade as never
    );
  };

  it("replaces draft and passes publish precheck when policy/table checks are aligned", async () => {
    const service = buildService();
    const replaced = await service.replaceDraft(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      edges: edgePayload
    });
    expect(replaced.draft.revision).toBe(1);

    const precheck = await service.publishPrecheck(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      draftRevision: 1
    });
    expect(precheck.publish_precheck_passed).toBe(true);
    expect(precheck.blockingReasons).toEqual([]);
  });

  it("blocks publish when gate returns fail-closed result", async () => {
    const service = buildService({
      gatePass: false
    });
    await service.replaceDraft(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      edges: edgePayload
    });

    await expect(
      service.publishDraft(actor, "ws-1", "ds-1", {
        policyVersion: 3,
        draftRevision: 1,
        representativeSqlSamples: ["SELECT 1"]
      })
    ).rejects.toMatchObject({
      code: "WORKSPACE_RELATIONSHIP_PUBLISH_GATE_FAILED"
    });
  });

  it("supports rollback to a previous revision", async () => {
    const service = buildService();
    await service.replaceDraft(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      edges: edgePayload
    });
    await service.replaceDraft(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      edges: [
        ...edgePayload,
        {
          id: "edge-orders-products",
          name: "orders_to_products",
          bridge: {
            left: {
              dataset: "sales",
              table: "orders",
              column: "product_id"
            },
            right: {
              dataset: "sales",
              table: "products",
              column: "id"
            },
            operator: "eq" as const,
            confidence: 0.7
          }
        }
      ]
    });

    const rollback = await service.rollbackDraft(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      draftRevision: 2,
      rollbackToRevision: 1
    });
    expect(rollback.activeRevision).toBe(1);
  });
});
