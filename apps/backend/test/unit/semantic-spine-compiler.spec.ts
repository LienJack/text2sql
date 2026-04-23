import { SemanticSpineCompilerService } from "../../src/modules/knowledge/semantic-spine/semantic-spine-compiler.service";
import type {
  SemanticSpineSnapshotLookupInput,
  SemanticSpineSnapshotLookupResult
} from "../../src/modules/knowledge/semantic-spine/semantic-spine.types";

class SemanticSpineRepositoryStub {
  constructor(
    private readonly resolver: (
      input: SemanticSpineSnapshotLookupInput
    ) => Promise<SemanticSpineSnapshotLookupResult>
  ) {}

  resolveSnapshot(input: SemanticSpineSnapshotLookupInput) {
    return this.resolver(input);
  }
}

const buildReadySnapshot = () => ({
  calculatedFields: [
    {
      binding: "orders.amount_paid - orders.refund_amount",
      key: "cf.net_amount",
      model: "model.orders",
      name: "net_amount"
    }
  ],
  metrics: [
    {
      aggregation: "sum",
      binding: "sum(orders.amount_paid)",
      key: "metric.gmv",
      model: "model.orders",
      name: "gmv"
    }
  ],
  models: [
    {
      binding: "public.orders",
      key: "model.orders",
      name: "orders"
    }
  ],
  relationships: [
    {
      binding: "orders.customer_id = customers.id",
      fromModel: "model.orders",
      key: "rel.orders_customers",
      name: "orders_customers",
      toModel: "model.customers"
    }
  ]
});

describe("semantic spine compiler", () => {
  it("compiles snapshot into bindings + instruction sets with evidence", async () => {
    const compiler = new SemanticSpineCompilerService(
      new SemanticSpineRepositoryStub(async () => ({
        matched_domain: "semantic_term::datasource::ds1",
        matched_scope: "datasource",
        risk_tags: [],
        semantic_version: 7,
        snapshot: buildReadySnapshot(),
        status: "ready"
      })) as never
    );

    const result = await compiler.compile({
      datasourceId: "ds1",
      domain: "semantic_term"
    });

    expect(result.status).toBe("ready");
    expect(result.semanticVersion).toBe(7);
    expect(result.semanticBindings.models["model.orders"]).toBeDefined();
    expect(result.instructionSets.metricBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aggregation: "sum",
          binding: "sum(orders.amount_paid)",
          key: "metric.gmv"
        })
      ])
    );
    expect(result.evidence.matchedScope).toBe("datasource");
    expect(result.evidence.matchedObjectKeys).toEqual(
      expect.arrayContaining([
        "model.orders",
        "rel.orders_customers",
        "metric.gmv",
        "cf.net_amount"
      ])
    );
  });

  it("returns degraded output with reason when snapshot is unavailable", async () => {
    const compiler = new SemanticSpineCompilerService(
      new SemanticSpineRepositoryStub(async () => ({
        degrade_reason: "semantic_spine_snapshot_not_found",
        risk_tags: ["semantic_spine_degraded"],
        status: "degraded"
      })) as never
    );

    const result = await compiler.compile({
      datasourceId: "ds-missing",
      domain: "semantic_term"
    });

    expect(result.status).toBe("degraded");
    expect(result.evidence.degradeReason).toBe("semantic_spine_snapshot_not_found");
    expect(result.riskTags).toEqual(expect.arrayContaining(["semantic_spine_degraded"]));
    expect(result.confidence.score).toBe(0);
  });
});
