type SemanticSpineStatus = "active" | "deprecated";

type SemanticSpineValidationIssue = {
  code: string;
  message: string;
  path: string;
};

type SemanticSpineModel = {
  model: string;
  table: string;
};

type SemanticSpineMetric = {
  binding?: string;
  metric: string;
};

type SemanticSpineObject = {
  calculated_fields: Array<{
    expression: string;
    field: string;
    model: string;
  }>;
  metrics: SemanticSpineMetric[];
  models: SemanticSpineModel[];
  relationships: Array<{
    from_model: string;
    name: string;
    on: string;
    to_model: string;
  }>;
};

type SemanticSpineSnapshot = {
  activatedByRunId?: string;
  domain: string;
  publishedAt: string;
  publishedByRunId?: string;
  riskTags: string[];
  semanticObject: SemanticSpineObject;
  status: SemanticSpineStatus;
  version: number;
};

type PublishSemanticSpineSnapshotInput = {
  activatedByRunId?: string;
  domain: string;
  publishedByRunId?: string;
  riskTags?: string[];
  semanticObject: SemanticSpineObject;
  version: number;
};

class SemanticSpineContractError extends Error {
  constructor(
    readonly code:
      | "SEMANTIC_SPINE_DUPLICATE_VERSION"
      | "SEMANTIC_SPINE_INVALID_OBJECT",
    readonly diagnostics: SemanticSpineValidationIssue[] = []
  ) {
    super(code);
  }
}

const validateSemanticObject = (
  semanticObject: SemanticSpineObject
): SemanticSpineValidationIssue[] => {
  const issues: SemanticSpineValidationIssue[] = [];

  semanticObject.models.forEach((model, index) => {
    if (!model.model.trim()) {
      issues.push({
        code: "required",
        message: "model is required",
        path: `models[${index}].model`
      });
    }
    if (!model.table.trim()) {
      issues.push({
        code: "required",
        message: "table is required",
        path: `models[${index}].table`
      });
    }
  });

  semanticObject.metrics.forEach((metric, index) => {
    if (!metric.metric.trim()) {
      issues.push({
        code: "required",
        message: "metric is required",
        path: `metrics[${index}].metric`
      });
    }
    if (!metric.binding?.trim()) {
      issues.push({
        code: "required",
        message: "metric binding is required",
        path: `metrics[${index}].binding`
      });
    }
  });

  return issues;
};

class InMemorySemanticSpineRepositoryDouble {
  private readonly snapshots: SemanticSpineSnapshot[] = [];

  publish(input: PublishSemanticSpineSnapshotInput): SemanticSpineSnapshot {
    const duplicated = this.snapshots.some(
      (item) => item.domain === input.domain && item.version === input.version
    );
    if (duplicated) {
      throw new SemanticSpineContractError("SEMANTIC_SPINE_DUPLICATE_VERSION");
    }

    const diagnostics = validateSemanticObject(input.semanticObject);
    if (diagnostics.length > 0) {
      throw new SemanticSpineContractError(
        "SEMANTIC_SPINE_INVALID_OBJECT",
        diagnostics
      );
    }

    this.snapshots.forEach((item) => {
      if (item.domain === input.domain && item.status === "active") {
        item.status = "deprecated";
      }
    });

    const created: SemanticSpineSnapshot = {
      activatedByRunId: input.activatedByRunId,
      domain: input.domain,
      publishedAt: "2026-04-22T00:00:00.000Z",
      publishedByRunId: input.publishedByRunId,
      riskTags: input.riskTags ?? [],
      semanticObject: input.semanticObject,
      status: "active",
      version: input.version
    };

    this.snapshots.push(created);
    return created;
  }

  readByDomainAndVersion(
    domain: string,
    version: number
  ): SemanticSpineSnapshot | undefined {
    return this.snapshots.find(
      (item) => item.domain === domain && item.version === version
    );
  }
}

const buildValidSemanticObject = (): SemanticSpineObject => ({
  calculated_fields: [
    {
      expression: "amount_paid - refund_amount",
      field: "net_amount",
      model: "orders"
    }
  ],
  metrics: [
    {
      binding: "sum(orders.amount_paid)",
      metric: "gmv"
    }
  ],
  models: [
    {
      model: "orders",
      table: "public.orders"
    }
  ],
  relationships: [
    {
      from_model: "orders",
      name: "orders_to_customers",
      on: "orders.customer_id = customers.id",
      to_model: "customers"
    }
  ]
});

describe("semantic spine contract (unit1)", () => {
  it("publishes and reads snapshot by domain+version with active status", () => {
    const repository = new InMemorySemanticSpineRepositoryDouble();

    repository.publish({
      domain: "sales",
      publishedByRunId: "run-semantic-spine-v1",
      semanticObject: buildValidSemanticObject(),
      version: 1
    });

    const snapshot = repository.readByDomainAndVersion("sales", 1);

    expect(snapshot).toBeDefined();
    expect(snapshot?.status).toBe("active");
    expect(snapshot?.version).toBe(1);
  });

  it("rejects duplicate version publish with traceable error code", () => {
    const repository = new InMemorySemanticSpineRepositoryDouble();
    repository.publish({
      domain: "sales",
      semanticObject: buildValidSemanticObject(),
      version: 1
    });

    expect(() =>
      repository.publish({
        domain: "sales",
        semanticObject: buildValidSemanticObject(),
        version: 1
      })
    ).toThrowError(
      expect.objectContaining({
        code: "SEMANTIC_SPINE_DUPLICATE_VERSION"
      })
    );
  });

  it("rejects invalid semantic object with field-level diagnostics", () => {
    const repository = new InMemorySemanticSpineRepositoryDouble();
    const invalidObject = buildValidSemanticObject();
    invalidObject.metrics = [
      {
        metric: "gmv"
      }
    ];

    try {
      repository.publish({
        domain: "sales",
        semanticObject: invalidObject,
        version: 1
      });
      throw new Error("expected publish to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SemanticSpineContractError);
      const contractError = error as SemanticSpineContractError;
      expect(contractError.code).toBe("SEMANTIC_SPINE_INVALID_OBJECT");
      expect(contractError.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "metrics[0].binding"
          })
        ])
      );
    }
  });
});
