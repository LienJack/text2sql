import { DomainError } from "../../src/common/domain-error";
import { WorkspaceModelingService } from "../../src/modules/governance/workspace/workspace-modeling.service";

const actor = {
  id: "user-admin",
  role: "admin" as const
};

const buildService = (options?: {
  permissionError?: DomainError;
}) => {
  const workspaceDatasourceService = {
    listDatasourceTables: jest.fn(async () => ({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      items: ["customers", "orders", "payments"]
    })),
    listDatasourceTablePermissions: jest.fn(async () => {
      if (options?.permissionError) {
        throw options.permissionError;
      }
      return {
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        policyVersion: 7,
        tableNames: ["customers", "orders"]
      };
    })
  };
  const workspaceRelationshipService = {
    getDraft: jest.fn(async () => ({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      activeRevision: 3,
      draft: {
        policyVersion: 7,
        revision: 4,
        graphHash: "graph-hash-v4",
        edges: [],
        updatedAt: "2026-04-23T11:00:00.000Z",
        updatedByActorId: "user-admin"
      }
    })),
    replaceDraft: jest.fn(async (_actor, workspaceId, datasourceId, body) => ({
      workspaceId,
      datasourceId,
      draft: {
        policyVersion: body.policyVersion,
        revision: 5,
        graphHash: "graph-hash-v5",
        edges: body.edges,
        updatedAt: "2026-04-23T12:00:00.000Z",
        updatedByActorId: "user-admin"
      }
    }))
  };
  const datasourceRepository = {
    getDatasourceById: jest.fn(async () => ({
      id: "ds-1",
      name: "sqlite demo",
      type: "sqlite" as const,
      status: "available" as const
    }))
  };
  const queryExecutorRouter = {
    execute: jest.fn(async ({ sql }: { sql: string }) => {
      if (sql.includes("pragma_table_info('customers')")) {
        return {
          columns: ["columnName", "dataType", "notnull", "pk"],
          rows: [
            { columnName: "id", dataType: "integer", notnull: 1, pk: 1 },
            { columnName: "name", dataType: "text", notnull: 0, pk: 0 }
          ]
        };
      }
      if (sql.includes("pragma_table_info('orders')")) {
        return {
          columns: ["columnName", "dataType", "notnull", "pk"],
          rows: [
            { columnName: "id", dataType: "integer", notnull: 1, pk: 1 },
            { columnName: "customer_id", dataType: "integer", notnull: 1, pk: 0 },
            { columnName: "total_amount", dataType: "numeric", notnull: 0, pk: 0 }
          ]
        };
      }
      if (sql.includes("pragma_foreign_key_list('orders')")) {
        return {
          columns: ["targetTable", "sourceColumn", "targetColumn"],
          rows: [{ targetTable: "customers", sourceColumn: "customer_id", targetColumn: "id" }]
        };
      }
      if (sql.includes("pragma_foreign_key_list('customers')")) {
        return {
          columns: ["targetTable", "sourceColumn", "targetColumn"],
          rows: []
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    })
  };

  return {
    service: new WorkspaceModelingService(
      workspaceDatasourceService as never,
      workspaceRelationshipService as never,
      datasourceRepository as never,
      queryExecutorRouter as never
    ),
    workspaceRelationshipService
  };
};

describe("workspace modeling setup integration", () => {
  it("builds setup preview and commits selected recommendations to relationship draft", async () => {
    const { service, workspaceRelationshipService } = buildService();

    const preview = await service.previewSetup(actor, "ws-1", "ds-1", {
      policyVersion: 7,
      selectedTables: ["Orders", "customers"],
      selectedRecommendationIds: undefined
    });

    expect(preview.stage).toBe("setup_preview_ready");
    expect(preview.selectedTables).toEqual(["customers", "orders"]);
    expect(preview.models).toHaveLength(2);
    expect(preview.relationshipRecommendations).toHaveLength(1);
    expect(preview.relationshipRecommendations[0]?.sourceTable).toBe("orders");
    expect(preview.relationshipRecommendations[0]?.targetTable).toBe("customers");
    expect(preview.relationshipRecommendations[0]?.reason).toBe("foreign_key_constraint");

    const committed = await service.commitSetup(
      actor,
      "ws-1",
      "ds-1",
      {
        policyVersion: 7,
        selectedTables: ["Orders", "customers"],
        selectedRecommendationIds: [preview.relationshipRecommendations[0]!.id]
      },
      "setup-commit-1"
    );

    expect(committed.stage).toBe("setup_commit_applied");
    expect(committed.committedRelationshipCount).toBe(1);
    expect(committed.draft.revision).toBe(5);
    expect(workspaceRelationshipService.replaceDraft).toHaveBeenCalledTimes(1);
    expect(workspaceRelationshipService.replaceDraft).toHaveBeenCalledWith(
      actor,
      "ws-1",
      "ds-1",
      expect.objectContaining({
        policyVersion: 7,
        edges: [
          expect.objectContaining({
            id: preview.relationshipRecommendations[0]!.id
          })
        ],
        modelingGraphPayload: expect.objectContaining({
          models: expect.arrayContaining([
            expect.objectContaining({ id: "customers", modelName: "Customers" }),
            expect.objectContaining({ id: "orders", modelName: "Orders" })
          ]),
          relationships: [
            expect.objectContaining({
              id: preview.relationshipRecommendations[0]!.id,
              source: "fk"
            })
          ]
        })
      })
    );
  });

  it("fails closed when workspace datasource binding is missing", async () => {
    const { service } = buildService({
      permissionError: new DomainError(
        "WORKSPACE_DATASOURCE_NOT_BOUND",
        "当前工作空间未绑定该数据源。",
        400
      )
    });

    await expect(
      service.previewSetup(actor, "ws-1", "ds-1", {
        policyVersion: 7,
        selectedTables: ["orders"],
        selectedRecommendationIds: undefined
      })
    ).rejects.toMatchObject({
      code: "WORKSPACE_DATASOURCE_NOT_BOUND"
    });
  });

  it("replays commit response with same idempotency key and payload", async () => {
    const { service, workspaceRelationshipService } = buildService();
    const body = {
      policyVersion: 7,
      selectedTables: ["orders", "customers"],
      selectedRecommendationIds: undefined
    };

    const first = await service.commitSetup(actor, "ws-1", "ds-1", body, "replay-setup-1");
    const second = await service.commitSetup(actor, "ws-1", "ds-1", body, "replay-setup-1");

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.draft).toEqual(first.draft);
    expect(workspaceRelationshipService.replaceDraft).toHaveBeenCalledTimes(1);
  });

  it("commits empty relationship set when explicit selection is empty", async () => {
    const { service, workspaceRelationshipService } = buildService();

    const committed = await service.commitSetup(
      actor,
      "ws-1",
      "ds-1",
      {
        policyVersion: 7,
        selectedTables: ["orders", "customers"],
        selectedRecommendationIds: []
      },
      "replay-empty-selection"
    );

    expect(committed.committedRelationshipCount).toBe(0);
    expect(workspaceRelationshipService.replaceDraft).toHaveBeenCalledWith(
      actor,
      "ws-1",
      "ds-1",
      expect.objectContaining({
        edges: [],
        modelingGraphPayload: expect.objectContaining({
          models: expect.arrayContaining([
            expect.objectContaining({ id: "customers" }),
            expect.objectContaining({ id: "orders" })
          ]),
          relationships: []
        })
      })
    );
  });

  it("returns modeling graph snapshot with draft payload", async () => {
    const { service } = buildService();

    const snapshot = await service.getModelingGraph(actor, "ws-1", "ds-1");

    expect(snapshot.workspaceId).toBe("ws-1");
    expect(snapshot.datasourceId).toBe("ds-1");
    expect(snapshot.activeRevision).toBe(3);
    expect(snapshot.draft?.revision).toBe(4);
    expect(snapshot.draft?.graphPayload).toEqual({
      models: [],
      relationships: [],
      calculatedFields: [],
      views: [],
      schemaChanges: []
    });
  });

  it("upserts modeling graph patch via unified draft replace flow", async () => {
    const { service, workspaceRelationshipService } = buildService();

    const upserted = await service.upsertModelingGraph(actor, "ws-1", "ds-1", {
      policyVersion: 7,
      models: [
        {
          id: "orders",
          tableName: "orders",
          modelName: "Orders",
          columns: [
            {
              name: "id",
              dataType: "integer",
              isNullable: false,
              isPrimaryKey: true
            }
          ]
        }
      ],
      relationships: [
        {
          id: "rel-orders-customers",
          source: "fk",
          bridge: {
            left: {
              dataset: "ds-1",
              table: "orders",
              column: "customer_id"
            },
            right: {
              dataset: "ds-1",
              table: "customers",
              column: "id"
            },
            operator: "eq",
            confidence: 0.99
          }
        }
      ]
    });

    expect(upserted.draft?.graphPayload.models).toHaveLength(1);
    expect(upserted.draft?.graphPayload.relationships).toHaveLength(1);
    expect(workspaceRelationshipService.replaceDraft).toHaveBeenCalledWith(
      actor,
      "ws-1",
      "ds-1",
      expect.objectContaining({
        policyVersion: 7,
        edges: [
          expect.objectContaining({
            id: "rel-orders-customers"
          })
        ],
        modelingGraphPayload: expect.objectContaining({
          models: [expect.objectContaining({ id: "orders", tableName: "orders" })],
          relationships: [expect.objectContaining({ id: "rel-orders-customers", source: "fk" })]
        })
      })
    );
  });

  it("fails closed when modeling graph models include forbidden table", async () => {
    const { service, workspaceRelationshipService } = buildService();

    await expect(
      service.upsertModelingGraph(actor, "ws-1", "ds-1", {
        policyVersion: 7,
        models: [
          {
            id: "payments",
            tableName: "payments",
            modelName: "Payments",
            columns: []
          }
        ]
      })
    ).rejects.toMatchObject({
      code: "WORKSPACE_MODELING_GRAPH_MODEL_FORBIDDEN"
    });
    expect(workspaceRelationshipService.replaceDraft).not.toHaveBeenCalled();
  });
});
