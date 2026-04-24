import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

type SemanticSpineStatus = "active" | "deprecated";

type SemanticSpineValidationIssue = {
  code: string;
  message: string;
  path: string;
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
  models: Array<{
    model: string;
    table: string;
  }>;
  relationships: Array<{
    from_model: string;
    name: string;
    on: string;
    to_model: string;
  }>;
};

type SemanticSpineSnapshot = {
  domain: string;
  publishedAt: string;
  semanticObject: SemanticSpineObject;
  status: SemanticSpineStatus;
  version: number;
};

type PublishSemanticSpineSnapshotInput = {
  domain: string;
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

class JsonFileSemanticSpineRepositoryDouble {
  constructor(private readonly filePath: string) {}

  async publish(input: PublishSemanticSpineSnapshotInput): Promise<void> {
    const snapshots = await this.readAll();

    if (
      snapshots.some(
        (item) => item.domain === input.domain && item.version === input.version
      )
    ) {
      throw new SemanticSpineContractError("SEMANTIC_SPINE_DUPLICATE_VERSION");
    }

    const diagnostics = validateSemanticObject(input.semanticObject);
    if (diagnostics.length > 0) {
      throw new SemanticSpineContractError(
        "SEMANTIC_SPINE_INVALID_OBJECT",
        diagnostics
      );
    }

    snapshots.forEach((item) => {
      if (item.domain === input.domain && item.status === "active") {
        item.status = "deprecated";
      }
    });

    snapshots.push({
      domain: input.domain,
      publishedAt: "2026-04-22T00:00:00.000Z",
      semanticObject: input.semanticObject,
      status: "active",
      version: input.version
    });

    await this.writeAll(snapshots);
  }

  async readByDomainAndVersion(
    domain: string,
    version: number
  ): Promise<SemanticSpineSnapshot | undefined> {
    const snapshots = await this.readAll();
    return snapshots.find(
      (item) => item.domain === domain && item.version === version
    );
  }

  private async readAll(): Promise<SemanticSpineSnapshot[]> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return JSON.parse(content) as SemanticSpineSnapshot[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async writeAll(snapshots: SemanticSpineSnapshot[]): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(snapshots, null, 2), "utf8");
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

describe("semantic spine persistence (unit1 integration)", () => {
  let tempDir = "";
  let filePath = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "semantic-spine-persistence-"));
    filePath = join(tempDir, "semantic-spine-snapshots.json");
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("publishes by domain+version and keeps status transitions active/deprecated", async () => {
    const repository = new JsonFileSemanticSpineRepositoryDouble(filePath);

    await repository.publish({
      domain: "sales",
      semanticObject: buildValidSemanticObject(),
      version: 1
    });
    await repository.publish({
      domain: "sales",
      semanticObject: buildValidSemanticObject(),
      version: 2
    });

    const current = await repository.readByDomainAndVersion("sales", 2);
    const old = await repository.readByDomainAndVersion("sales", 1);

    expect(current?.status).toBe("active");
    expect(current?.version).toBe(2);
    expect(old?.status).toBe("deprecated");
    expect(old?.version).toBe(1);
  });

  it("keeps old versions queryable for replay after repository restart", async () => {
    const writer = new JsonFileSemanticSpineRepositoryDouble(filePath);
    await writer.publish({
      domain: "sales",
      semanticObject: buildValidSemanticObject(),
      version: 1
    });
    await writer.publish({
      domain: "sales",
      semanticObject: buildValidSemanticObject(),
      version: 2
    });

    const reader = new JsonFileSemanticSpineRepositoryDouble(filePath);
    const replayV1 = await reader.readByDomainAndVersion("sales", 1);
    const replayV2 = await reader.readByDomainAndVersion("sales", 2);

    expect(replayV1).toBeDefined();
    expect(replayV1?.status).toBe("deprecated");
    expect(replayV2).toBeDefined();
    expect(replayV2?.status).toBe("active");
  });

  it("rejects duplicate version and invalid semantic object with field diagnostics", async () => {
    const repository = new JsonFileSemanticSpineRepositoryDouble(filePath);
    await repository.publish({
      domain: "sales",
      semanticObject: buildValidSemanticObject(),
      version: 1
    });

    await expect(
      repository.publish({
        domain: "sales",
        semanticObject: buildValidSemanticObject(),
        version: 1
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: "SEMANTIC_SPINE_DUPLICATE_VERSION"
      })
    );

    await expect(
      repository.publish({
        domain: "sales",
        semanticObject: {
          ...buildValidSemanticObject(),
          metrics: [{ metric: "gmv" }]
        },
        version: 3
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: "SEMANTIC_SPINE_INVALID_OBJECT",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            path: "metrics[0].binding"
          })
        ])
      })
    );
  });
});
