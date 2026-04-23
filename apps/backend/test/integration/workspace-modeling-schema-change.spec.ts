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

  it("detects deleted/modified schema changes and resolves one item idempotently", async () => {
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
        }
      ],
      relationships: [],
      calculatedFields: [],
      views: [],
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
    expect(detected.summary.deletedColumnCount).toBe(1);
    expect(detected.summary.modifiedColumnCount).toBe(1);
    expect(detected.unresolvedHighRiskCount).toBeGreaterThanOrEqual(1);
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

    const firstChangeId = detected.changes.deleted[0]?.id ?? detected.changes.modified[0]?.id;
    expect(firstChangeId).toBeTruthy();

    const resolved = await service.resolveModelingSchemaChange(actor, "ws-1", "ds-1", {
      policyVersion: 7,
      changeId: firstChangeId!
    });
    expect(resolved.stage).toBe("schema_change_resolved");
    expect(resolved.alreadyResolved).toBe(false);
    expect(resolved.schemaChange.status).toBe("resolved");

    const replayResolve = await service.resolveModelingSchemaChange(actor, "ws-1", "ds-1", {
      policyVersion: 7,
      changeId: firstChangeId!
    });
    expect(replayResolve.alreadyResolved).toBe(true);
    expect(replayResolve.schemaChange.status).toBe("resolved");
    expect(appendAuditEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        datasourceId: "ds-1",
        event: expect.objectContaining({
          action: "resolve",
          outcome: "already_resolved",
          changeId: firstChangeId
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
