import { ModelingGraphRepository } from "../../src/modules/platform/data/persistence/modeling-graph.repository";
import { ModelingGraphValidator } from "../../src/modules/platform/data/persistence/modeling-graph.validator";
import { WorkspaceCalculatedFieldExpressionValidatorService } from "../../src/modules/governance/workspace/workspace-calculated-field-expression-validator.service";
import { WorkspaceModelingService } from "../../src/modules/governance/workspace/workspace-modeling.service";
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
        dataset: "ds-1",
        table: "orders",
        column: "customer_id"
      },
      right: {
        dataset: "ds-1",
        table: "customers",
        column: "id"
      },
      operator: "eq" as const,
      confidence: 0.91
    }
  }
];

const buildModelingRepository = () =>
  new ModelingGraphRepository({
    databaseUrl: ""
  } as never);

const buildRelationshipService = (modelingGraphRepository: ModelingGraphRepository) => {
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
    isDatasourceBound: async () => true,
    getWorkspaceDatasourceTablePermissionSet: async () => ({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      policyVersion: 3,
      tableNames: ["customers", "orders"]
    })
  };
  const auditLogRepository = {
    appendEvent: async () => undefined
  };
  const publishGateFacade = {
    evaluate: async () => ({
      pass: true,
      riskLevel: "low" as const,
      blockingReasons: [],
      dryRun: {
        pass: true,
        executedCount: 1,
        failedSamples: []
      }
    })
  };

  const modelingGraphValidator = new ModelingGraphValidator();

  return new WorkspaceRelationshipService(
    workspaceRepository as never,
    datasourceRepository as never,
    policyRepository as never,
    auditLogRepository as never,
    publishGateFacade as never,
    modelingGraphRepository,
    modelingGraphValidator
  );
};

const buildModelingService = () => {
  const modelingGraphRepository = buildModelingRepository();
  const workspaceRelationshipService = buildRelationshipService(modelingGraphRepository);
  const workspaceDatasourceService = {
    listDatasourceTablePermissions: jest.fn(async () => ({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      policyVersion: 3,
      tableNames: ["customers", "orders"]
    }))
  };
  const datasourceRepository = {
    getDatasourceById: jest.fn(async () => ({
      id: "ds-1",
      status: "available"
    }))
  };
  const queryExecutorRouter = {
    execute: jest.fn()
  };
  const calculatedFieldExpressionValidator =
    new WorkspaceCalculatedFieldExpressionValidatorService();

  return {
    service: new WorkspaceModelingService(
      workspaceDatasourceService as never,
      workspaceRelationshipService as never,
      datasourceRepository as never,
      queryExecutorRouter as never,
      calculatedFieldExpressionValidator,
      modelingGraphRepository
    ),
    queryExecutorRouter
  };
};

describe("workspace modeling graph revision integration", () => {
  const baseModelPayload = [
    {
      id: "orders",
      tableName: "orders",
      modelName: "Orders",
      columns: [
        { name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true },
        { name: "total_amount", dataType: "numeric", isNullable: false, isPrimaryKey: false }
      ]
    }
  ];

  it("tracks revision history and single active pointer", async () => {
    const repository = buildModelingRepository();
    const basePayload = {
      models: [],
      relationships: [],
      calculatedFields: [],
      views: [],
      schemaChanges: []
    };

    const v1 = await repository.appendDraftRevision({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      graphHash: "hash-v1",
      graphPayload: basePayload,
      actorId: actor.id
    });
    const v2 = await repository.appendDraftRevision({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      graphHash: "hash-v2",
      graphPayload: basePayload,
      actorId: actor.id
    });

    expect(v1.revision).toBe(1);
    expect(v2.revision).toBe(2);
    await repository.markActiveRevision({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      revision: 1,
      actorId: actor.id
    });
    await repository.markActiveRevision({
      workspaceId: "ws-1",
      datasourceId: "ds-1",
      revision: 2,
      actorId: actor.id
    });

    const state = await repository.getLatestScopeState({
      workspaceId: "ws-1",
      datasourceId: "ds-1"
    });
    expect(state.draft?.revision).toBe(2);
    expect(state.activeRevision).toBe(2);
  });

  it("hydrates relationship draft from persisted modeling revisions across service instances", async () => {
    const repository = buildModelingRepository();
    const serviceA = buildRelationshipService(repository);
    const serviceB = buildRelationshipService(repository);

    const first = await serviceA.replaceDraft(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      edges: edgePayload
    });
    expect(first.draft.revision).toBe(1);

    const hydratedDraft = await serviceB.getDraft(actor, "ws-1", "ds-1");
    expect(hydratedDraft.draft?.revision).toBe(1);
    expect(hydratedDraft.draft?.edges).toHaveLength(1);

    const second = await serviceB.replaceDraft(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      edges: edgePayload
    });
    expect(second.draft.revision).toBe(2);
  });

  it("rejects invalid modeling graph payload before revision persistence", async () => {
    const repository = buildModelingRepository();
    const service = buildRelationshipService(repository);

    await expect(
      service.replaceDraft(actor, "ws-1", "ds-1", {
        policyVersion: 3,
        edges: edgePayload,
        modelingGraphPayload: {
          models: [
            {
              id: "orders",
              tableName: "orders",
              modelName: "Orders",
              columns: []
            },
            {
              id: "orders",
              tableName: "orders_backup",
              modelName: "OrdersBackup",
              columns: []
            }
          ],
          relationships: [],
          calculatedFields: [],
          views: [],
          schemaChanges: []
        }
      })
    ).rejects.toMatchObject({
      code: "WORKSPACE_MODELING_GRAPH_INVALID"
    });
  });

  it("keeps modeling graph patch slices coherent for model/cf/relationship/view updates", async () => {
    const { service } = buildModelingService();

    const first = await service.upsertModelingGraph(actor, "ws-1", "ds-1", {
      policyVersion: 3,
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
      relationships: [
        {
          id: "rel_orders_customers",
          name: "orders_to_customers",
          source: "manual",
          confidence: 0.91,
          type: "many-to-one",
          bridge: edgePayload[0]!.bridge
        }
      ],
      calculatedFields: [
        {
          id: "cf_total_with_tax",
          modelId: "orders",
          name: "total_with_tax",
          expression: "total_amount * 1.1",
          dataType: "numeric"
        }
      ],
      views: [
        {
          id: "view_orders",
          name: "orders_view",
          sql: "select id, total_amount from orders"
        }
      ]
    });

    const second = await service.upsertModelingGraph(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      models: [
        {
          id: "orders",
          tableName: "orders",
          modelName: "Orders",
          columns: [
            { name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true },
            { name: "total_amount", dataType: "numeric", isNullable: false, isPrimaryKey: false },
            { name: "discount_amount", dataType: "numeric", isNullable: true, isPrimaryKey: false }
          ]
        }
      ]
    });

    const third = await service.upsertModelingGraph(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      calculatedFields: [
        {
          id: "cf_total_with_tax",
          modelId: "orders",
          name: "total_with_tax",
          expression: "total_amount - coalesce(discount_amount, 0)",
          dataType: "numeric"
        }
      ],
      relationships: [
        {
          id: "rel_orders_customers",
          name: "orders_to_customers",
          source: "manual",
          confidence: 0.95,
          type: "one-to-many",
          bridge: edgePayload[0]!.bridge
        }
      ],
      views: [
        {
          id: "view_orders",
          name: "orders_view",
          sql: "select id, total_amount, discount_amount from orders"
        }
      ]
    });

    expect(first.draft?.graphPayload.models).toHaveLength(1);
    expect(second.draft?.graphPayload.models[0]?.columns).toHaveLength(3);
    expect(second.draft?.graphPayload.calculatedFields).toEqual(first.draft?.graphPayload.calculatedFields);
    expect(second.draft?.graphPayload.relationships).toEqual(first.draft?.graphPayload.relationships);
    expect(second.draft?.graphPayload.views).toEqual(first.draft?.graphPayload.views);

    expect(third.draft?.graphPayload.models).toEqual(second.draft?.graphPayload.models);
    expect(third.draft?.graphPayload.relationships[0]?.confidence).toBe(0.95);
    expect(third.draft?.graphPayload.relationships[0]?.type).toBe("one-to-many");
    expect(third.draft?.graphPayload.relationships[0]?.cardinality).toBe("one-to-many");
    expect(third.draft?.graphPayload.views[0]?.sql).toContain("discount_amount");
    expect(third.draft?.graphPayload.calculatedFields[0]?.expression).toContain("coalesce");
  });

  it("maps invalid calculated-field expression to stable domain error details", async () => {
    const { service } = buildModelingService();

    await expect(
      service.upsertModelingGraph(actor, "ws-1", "ds-1", {
        policyVersion: 3,
        models: baseModelPayload,
        calculatedFields: [
          {
            id: "cf_invalid",
            modelId: "orders",
            name: "broken_field",
            expression: "total_amount +",
            dataType: "numeric"
          }
        ]
      })
    ).rejects.toMatchObject({
      code: "WORKSPACE_MODELING_GRAPH_CALCULATED_FIELD_EXPRESSION_INVALID",
      details: {
        category: "syntax",
        field: "expression",
        calculatedFieldId: "cf_invalid",
        modelId: "orders",
        name: "broken_field"
      }
    });
  });

  it("returns modeling preview rows with truncation semantics for model target", async () => {
    const { service, queryExecutorRouter } = buildModelingService();
    queryExecutorRouter.execute.mockResolvedValueOnce({
      rows: [
        { id: 1, total_amount: 10.5 },
        { id: 2, total_amount: 20.1 }
      ]
    });

    await service.upsertModelingGraph(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      models: baseModelPayload
    });

    const preview = await service.getModelingPreview(actor, "ws-1", "ds-1", {
      targetKind: "model",
      targetId: "orders",
      limit: 1
    });

    expect(queryExecutorRouter.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("SELECT * FROM"),
        limit: 2
      })
    );
    expect(preview.targetKind).toBe("model");
    expect(preview.targetId).toBe("orders");
    expect(preview.rowCount).toBe(1);
    expect(preview.truncated).toBe(true);
    expect(preview.columns).toEqual(expect.arrayContaining(["id", "total_amount"]));
    expect(preview.rows).toEqual([{ id: 1, total_amount: 10.5 }]);
  });

  it("returns modeling preview rows for view target and wraps view sql safely", async () => {
    const { service, queryExecutorRouter } = buildModelingService();
    queryExecutorRouter.execute.mockResolvedValueOnce({
      rows: [
        { id: 7, total_amount: 99.2 },
        { id: 8, total_amount: 120.4 }
      ]
    });

    await service.upsertModelingGraph(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      models: baseModelPayload,
      views: [
        {
          id: "view_orders_recent",
          name: "orders_recent",
          sql: "SELECT id, total_amount FROM orders ORDER BY id DESC"
        }
      ]
    });

    const preview = await service.getModelingPreview(actor, "ws-1", "ds-1", {
      targetKind: "view",
      targetId: "view_orders_recent",
      limit: 1
    });

    expect(queryExecutorRouter.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("modeling_view_preview"),
        limit: 2
      })
    );
    expect(queryExecutorRouter.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("SELECT id, total_amount FROM orders ORDER BY id DESC")
      })
    );
    expect(preview.targetKind).toBe("view");
    expect(preview.targetId).toBe("view_orders_recent");
    expect(preview.rowCount).toBe(1);
    expect(preview.truncated).toBe(true);
    expect(preview.columns).toEqual(expect.arrayContaining(["id", "total_amount"]));
    expect(preview.rows).toEqual([{ id: 7, total_amount: 99.2 }]);
  });

  it("accepts aggregate/math/string functions from expression list", async () => {
    const { service } = buildModelingService();

    const result = await service.upsertModelingGraph(actor, "ws-1", "ds-1", {
      policyVersion: 3,
      models: [
        {
          id: "orders",
          tableName: "orders",
          modelName: "Orders",
          columns: [
            { name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true },
            { name: "total_amount", dataType: "numeric", isNullable: false, isPrimaryKey: false },
            { name: "customer_name", dataType: "text", isNullable: true, isPrimaryKey: false }
          ]
        }
      ],
      calculatedFields: [
        {
          id: "cf_total_sum",
          modelId: "orders",
          name: "total_sum",
          expression: "sum(total_amount)",
          dataType: "numeric"
        },
        {
          id: "cf_avg_rounded",
          modelId: "orders",
          name: "avg_rounded",
          expression: "round(avg(total_amount), 2)",
          dataType: "numeric"
        },
        {
          id: "cf_customer_name_upper",
          modelId: "orders",
          name: "customer_name_upper",
          expression: "upper(customer_name)",
          dataType: "string"
        }
      ]
    });

    expect(result.draft?.graphPayload.calculatedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cf_total_sum", expression: "sum(total_amount)" }),
        expect.objectContaining({ id: "cf_avg_rounded", expression: "round(avg(total_amount), 2)" }),
        expect.objectContaining({ id: "cf_customer_name_upper", expression: "upper(customer_name)" })
      ])
    );
  });

  it.each([
    {
      caseName: "type",
      expression: "coalesce(total_amount, 'fallback')",
      dataType: "numeric",
      expectedCategory: "type"
    },
    {
      caseName: "ref",
      expression: "missing_column + 1",
      dataType: "numeric",
      expectedCategory: "ref"
    },
    {
      caseName: "not-supported",
      expression: "select total_amount",
      dataType: "numeric",
      expectedCategory: "not-supported"
    }
  ])(
    "maps %s calculated-field expression errors to canonical category",
    async ({ expression, dataType, expectedCategory }) => {
      const { service } = buildModelingService();

      await expect(
        service.upsertModelingGraph(actor, "ws-1", "ds-1", {
          policyVersion: 3,
          models: baseModelPayload,
          calculatedFields: [
            {
              id: "cf_category_case",
              modelId: "orders",
              name: "category_case_field",
              expression,
              dataType
            }
          ]
        })
      ).rejects.toMatchObject({
        code: "WORKSPACE_MODELING_GRAPH_CALCULATED_FIELD_EXPRESSION_INVALID",
        details: {
          category: expectedCategory,
          field: "expression",
          calculatedFieldId: "cf_category_case",
          modelId: "orders",
          name: "category_case_field"
        }
      });
    }
  );

  it("returns function-list guidance when expression uses unsupported function", async () => {
    const { service } = buildModelingService();

    await expect(
      service.upsertModelingGraph(actor, "ws-1", "ds-1", {
        policyVersion: 3,
        models: baseModelPayload,
        calculatedFields: [
          {
            id: "cf_pow_case",
            modelId: "orders",
            name: "pow_case",
            expression: "pow(total_amount, 2)",
            dataType: "numeric"
          }
        ]
      })
    ).rejects.toMatchObject({
      code: "WORKSPACE_MODELING_GRAPH_CALCULATED_FIELD_EXPRESSION_INVALID",
      message: expect.stringContaining("pow"),
      details: {
        category: "not-supported",
        functionName: "pow",
        supportedFunctionGroups: {
          aggregate: expect.arrayContaining(["sum", "avg"]),
          math: expect.arrayContaining(["abs", "round"]),
          string: expect.arrayContaining(["upper", "concat"])
        }
      }
    });
  });
});
