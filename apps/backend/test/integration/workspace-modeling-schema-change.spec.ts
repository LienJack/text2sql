import { WorkspaceCalculatedFieldExpressionValidatorService } from "../../src/modules/governance/workspace/workspace-calculated-field-expression-validator.service";
import { WorkspaceModelingService } from "../../src/modules/governance/workspace/workspace-modeling.service";
import { ModelingSchemaChangeRepository } from "../../src/modules/platform/data/persistence/modeling-schema-change.repository";

const actor = {
  id: "user-admin",
  role: "admin" as const
};

describe("workspace modeling schema change integration", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("supports three-group detection, auto cleanup resolve, idempotent replay, and manual gate for type change", async () => {
    const appendAuditEventSpy = jest.spyOn(
      ModelingSchemaChangeRepository.prototype,
      "appendAuditEvent"
    );
    let revision = 2;
    let graphPayload = {
      models: [
        {
          id: "orders",
          tableName: "orders",
          modelName: "Orders",
          columns: [
            { name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true },
            { name: "total_amount", dataType: "numeric", isNullable: false, isPrimaryKey: false }
          ]
        },
        {
          id: "legacy_orders",
          tableName: "legacy_orders",
          modelName: "LegacyOrders",
          columns: [
            { name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true },
            { name: "order_id", dataType: "integer", isNullable: false, isPrimaryKey: false }
          ]
        }
      ],
      relationships: [
        {
          id: "rel-legacy-orders",
          source: "manual" as const,
          confidence: 0.9,
          bridge: {
            left: {
              dataset: "ds-1",
              table: "legacy_orders",
              column: "order_id"
            },
            right: {
              dataset: "ds-1",
              table: "orders",
              column: "id"
            },
            operator: "eq" as const,
            confidence: 0.9
          }
        },
        {
          id: "rel-orders-total",
          source: "manual" as const,
          confidence: 0.8,
          bridge: {
            left: {
              dataset: "ds-1",
              table: "orders",
              column: "total_amount"
            },
            right: {
              dataset: "ds-1",
              table: "orders",
              column: "id"
            },
            operator: "eq" as const,
            confidence: 0.8
          }
        }
      ],
      calculatedFields: [
        {
          id: "cf-legacy-order-id",
          modelId: "legacy_orders",
          name: "legacy_order_id",
          expression: "order_id",
          dataType: "integer"
        },
        {
          id: "cf-orders-total",
          modelId: "orders",
          name: "orders_total",
          expression: "total_amount * 1.1",
          dataType: "numeric"
        }
      ],
      views: [
        {
          id: "view-legacy",
          name: "legacy_orders_view",
          sql: "select * from legacy_orders"
        },
        {
          id: "view-orders-total",
          name: "orders_total_view",
          sql: "select total_amount from orders"
        }
      ],
      schemaChanges: []
    };

    const workspaceDatasourceService = {
      listDatasourceTablePermissions: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        policyVersion: 7,
        tableNames: ["orders"]
      })),
      listDatasourceTables: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        items: ["orders"]
      }))
    };

    const workspaceRelationshipService = {
      getDraft: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 1,
        draft: {
          policyVersion: 7,
          revision,
          graphHash: `graph-hash-v${revision}`,
          edges: [],
          updatedAt: "2026-04-23T11:00:00.000Z",
          updatedByActorId: actor.id
        }
      })),
      replaceDraft: jest.fn(async (_actor, workspaceId, datasourceId, body) => {
        revision += 1;
        graphPayload = body.modelingGraphPayload;
        return {
          workspaceId,
          datasourceId,
          draft: {
            policyVersion: body.policyVersion,
            revision,
            graphHash: `graph-hash-v${revision}`,
            edges: body.edges,
            updatedAt: "2026-04-23T12:00:00.000Z",
            updatedByActorId: actor.id
          }
        };
      })
    };

    const datasourceRepository = {
      getDatasourceById: jest.fn(async () => ({
        id: "ds-1",
        type: "sqlite" as const,
        status: "available" as const
      }))
    };

    const queryExecutorRouter = {
      execute: jest.fn(async ({ sql }: { sql: string }) => {
        if (sql.includes("pragma_table_info('orders')")) {
          return {
            columns: ["columnName", "dataType", "notnull", "pk"],
            rows: [{ columnName: "id", dataType: "text", notnull: 1, pk: 1 }]
          };
        }
        throw new Error(`unexpected sql: ${sql}`);
      })
    };

    const modelingGraphRepository = {
      findRevision: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        revision,
        graphHash: `graph-hash-v${revision}`,
        status: "draft" as const,
        graphPayload,
        updatedAt: "2026-04-23T11:00:00.000Z",
        createdByActorId: actor.id
      }))
    };

    const service = new WorkspaceModelingService(
      workspaceDatasourceService as never,
      workspaceRelationshipService as never,
      datasourceRepository as never,
      queryExecutorRouter as never,
      new WorkspaceCalculatedFieldExpressionValidatorService(),
      modelingGraphRepository as never
    );

    const detected = await service.detectModelingSchemaChanges(actor, "ws-1", "ds-1", {
      policyVersion: 7
    });
    expect(detected.stage).toBe("schema_change_detected");
    expect(detected.summary.deletedTableCount).toBe(1);
    expect(detected.summary.deletedColumnCount).toBe(1);
    expect(detected.summary.modifiedColumnCount).toBe(1);
    expect(detected.unresolvedHighRiskCount).toBe(3);
    expect(detected.highRiskStatus).toBe("high");
    expect(workspaceRelationshipService.replaceDraft).toHaveBeenCalledTimes(1);
    expect(appendAuditEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        event: expect.objectContaining({
          action: "detect",
          outcome: "detected",
          policyVersion: 7
        })
      })
    );

    const deletedTableChangeId = detected.changes.deletedTables[0]?.id;
    const deletedColumnChangeId = detected.changes.deletedColumns[0]?.id;
    const modifiedColumnChangeId = detected.changes.modifiedColumns[0]?.id;
    expect(deletedTableChangeId).toBeTruthy();
    expect(deletedColumnChangeId).toBeTruthy();
    expect(modifiedColumnChangeId).toBeTruthy();

    const resolveDeletedTable = await service.resolveModelingSchemaChange(actor, "ws-1", "ds-1", {
      policyVersion: 7,
      changeId: deletedTableChangeId!
    });
    expect(resolveDeletedTable.stage).toBe("schema_change_resolved");
    expect(resolveDeletedTable.alreadyResolved).toBe(false);
    expect(resolveDeletedTable.schemaChange.status).toBe("resolved");
    expect(resolveDeletedTable.unresolvedHighRiskCount).toBe(2);

    const snapshotAfterDeleteTable = await service.getModelingGraph(actor, "ws-1", "ds-1");
    const payloadAfterDeleteTable = snapshotAfterDeleteTable.draft?.graphPayload;
    expect(payloadAfterDeleteTable?.models.map((item) => item.id)).not.toContain("legacy_orders");
    expect(payloadAfterDeleteTable?.relationships.map((item) => item.id)).not.toContain(
      "rel-legacy-orders"
    );
    expect(payloadAfterDeleteTable?.calculatedFields.map((item) => item.id)).not.toContain(
      "cf-legacy-order-id"
    );
    expect(payloadAfterDeleteTable?.views.map((item) => item.id)).not.toContain("view-legacy");

    const replayResolveDeletedTable = await service.resolveModelingSchemaChange(
      actor,
      "ws-1",
      "ds-1",
      {
        policyVersion: 7,
        changeId: deletedTableChangeId!
      }
    );
    expect(replayResolveDeletedTable.alreadyResolved).toBe(true);
    expect(replayResolveDeletedTable.schemaChange.status).toBe("resolved");
    expect(workspaceRelationshipService.replaceDraft).toHaveBeenCalledTimes(2);

    const resolveDeletedColumn = await service.resolveModelingSchemaChange(actor, "ws-1", "ds-1", {
      policyVersion: 7,
      changeId: deletedColumnChangeId!
    });
    expect(resolveDeletedColumn.alreadyResolved).toBe(false);
    expect(resolveDeletedColumn.schemaChange.status).toBe("resolved");
    expect(resolveDeletedColumn.unresolvedHighRiskCount).toBe(1);

    const snapshotAfterDeleteColumn = await service.getModelingGraph(actor, "ws-1", "ds-1");
    const payloadAfterDeleteColumn = snapshotAfterDeleteColumn.draft?.graphPayload;
    const ordersModel = payloadAfterDeleteColumn?.models.find((item) => item.id === "orders");
    expect(ordersModel?.columns.map((item) => item.name)).toEqual(["id"]);
    expect(payloadAfterDeleteColumn?.relationships.map((item) => item.id)).not.toContain(
      "rel-orders-total"
    );
    expect(payloadAfterDeleteColumn?.calculatedFields.map((item) => item.id)).not.toContain(
      "cf-orders-total"
    );
    expect(payloadAfterDeleteColumn?.views.map((item) => item.id)).not.toContain(
      "view-orders-total"
    );

    const replayResolveDeletedColumn = await service.resolveModelingSchemaChange(
      actor,
      "ws-1",
      "ds-1",
      {
        policyVersion: 7,
        changeId: deletedColumnChangeId!
      }
    );
    expect(replayResolveDeletedColumn.alreadyResolved).toBe(true);
    expect(replayResolveDeletedColumn.schemaChange.status).toBe("resolved");
    expect(appendAuditEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        event: expect.objectContaining({
          action: "resolve",
          outcome: "already_resolved",
          changeId: deletedColumnChangeId
        })
      })
    );

    await expect(
      service.resolveModelingSchemaChange(actor, "ws-1", "ds-1", {
        policyVersion: 7,
        changeId: modifiedColumnChangeId!
      })
    ).rejects.toMatchObject({
      code: "WORKSPACE_MODELING_SCHEMA_CHANGE_MANUAL_RESOLUTION_REQUIRED",
      statusCode: 409
    });

    const schemaChangeState = await service.describeModelingSchemaChangeState(
      actor,
      "ws-1",
      "ds-1"
    );
    expect(schemaChangeState.highRiskStatus).toBe("high");
    expect(schemaChangeState.unresolvedHighRiskCount).toBe(1);
    expect(schemaChangeState.unresolvedSchemaChangeIds).toContain(modifiedColumnChangeId!);

    const replayDetected = await service.detectModelingSchemaChanges(actor, "ws-1", "ds-1", {
      policyVersion: 7
    });
    expect(replayDetected.unresolvedHighRiskCount).toBe(1);
    expect(workspaceRelationshipService.replaceDraft).toHaveBeenCalledTimes(3);
    expect(appendAuditEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        event: expect.objectContaining({
          action: "detect",
          outcome: "detected",
          policyVersion: 7,
          persisted: false
        })
      })
    );
  });

  it("returns not found when resolving unknown schema change id and records audit outcome", async () => {
    const appendAuditEventSpy = jest.spyOn(
      ModelingSchemaChangeRepository.prototype,
      "appendAuditEvent"
    );

    const workspaceDatasourceService = {
      listDatasourceTablePermissions: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        policyVersion: 7,
        tableNames: ["orders"]
      })),
      listDatasourceTables: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        items: ["orders"]
      }))
    };

    const workspaceRelationshipService = {
      getDraft: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        activeRevision: 1,
        draft: {
          policyVersion: 7,
          revision: 2,
          graphHash: "graph-hash-v2",
          edges: [],
          updatedAt: "2026-04-23T11:00:00.000Z",
          updatedByActorId: actor.id
        }
      })),
      replaceDraft: jest.fn()
    };

    const datasourceRepository = {
      getDatasourceById: jest.fn(async () => ({
        id: "ds-1",
        type: "sqlite" as const,
        status: "available" as const
      }))
    };

    const queryExecutorRouter = {
      execute: jest.fn(async ({ sql }: { sql: string }) => {
        if (sql.includes("pragma_table_info('orders')")) {
          return {
            columns: ["columnName", "dataType", "notnull", "pk"],
            rows: [{ columnName: "id", dataType: "integer", notnull: 1, pk: 1 }]
          };
        }
        throw new Error(`unexpected sql: ${sql}`);
      })
    };

    const modelingGraphRepository = {
      findRevision: jest.fn(async () => ({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        revision: 2,
        graphHash: "graph-hash-v2",
        status: "draft" as const,
        graphPayload: {
          models: [
            {
              id: "orders",
              tableName: "orders",
              modelName: "Orders",
              columns: [{ name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true }]
            }
          ],
          relationships: [],
          calculatedFields: [],
          views: [],
          schemaChanges: []
        },
        updatedAt: "2026-04-23T11:00:00.000Z",
        createdByActorId: actor.id
      }))
    };

    const service = new WorkspaceModelingService(
      workspaceDatasourceService as never,
      workspaceRelationshipService as never,
      datasourceRepository as never,
      queryExecutorRouter as never,
      new WorkspaceCalculatedFieldExpressionValidatorService(),
      modelingGraphRepository as never
    );

    await expect(
      service.resolveModelingSchemaChange(actor, "ws-1", "ds-1", {
        policyVersion: 7,
        changeId: "schema-change:deleted_column:orders:unknown_column"
      })
    ).rejects.toMatchObject({
      code: "WORKSPACE_MODELING_SCHEMA_CHANGE_NOT_FOUND",
      statusCode: 404
    });
    expect(appendAuditEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        event: expect.objectContaining({
          action: "resolve",
          outcome: "not_found",
          changeId: "schema-change:deleted_column:orders:unknown_column"
        })
      })
    );
  });
});
