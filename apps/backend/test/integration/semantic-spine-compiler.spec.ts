import { resolve } from "node:path";
import { AppConfigService } from "../../src/modules/config/app-config.service";
import { SemanticSpineCompilerService } from "../../src/modules/knowledge/semantic-spine/semantic-spine-compiler.service";
import { SemanticSpineRepository } from "../../src/modules/knowledge/semantic-spine/semantic-spine.repository";

const buildSnapshot = (suffix: string, metricBinding: string) => ({
  calculatedFields: [
    {
      binding: `orders.amount_paid - orders.refund_amount${suffix}`,
      key: `cf.net_amount${suffix}`,
      model: `model.orders${suffix}`,
      name: `net_amount${suffix}`
    }
  ],
  metrics: [
    {
      aggregation: "sum",
      binding: metricBinding,
      key: `metric.gmv${suffix}`,
      model: `model.orders${suffix}`,
      name: `gmv${suffix}`
    }
  ],
  models: [
    {
      binding: `public.orders${suffix}`,
      key: `model.orders${suffix}`,
      name: `orders${suffix}`
    },
    {
      binding: `public.customers${suffix}`,
      key: `model.customers${suffix}`,
      name: `customers${suffix}`
    }
  ],
  relationships: [
    {
      binding: `orders${suffix}.customer_id = customers${suffix}.id`,
      fromModel: `model.orders${suffix}`,
      key: `rel.orders_customers${suffix}`,
      name: `orders_customers${suffix}`,
      toModel: `model.customers${suffix}`
    }
  ]
});

describe("semantic spine compiler integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
  });

  it("prefers datasource-scoped snapshot over global fallback", async () => {
    const appConfig = new AppConfigService({
      get: <T>(key: string, defaultValue?: T): T => {
        const value = process.env[key];
        return (value ?? defaultValue) as T;
      }
    } as never);
    const repository = new SemanticSpineRepository(appConfig);
    const compiler = new SemanticSpineCompilerService(repository);
    const domain = "semantic_term";
    const datasourceId = "ds-semantic-compiler";
    const datasourceDomain = repository.buildDatasourceScopedDomain(domain, datasourceId);

    await repository.publishSnapshot({
      auditSummary: "global baseline",
      domain,
      releaseSummary: "global semantic spine",
      semanticVersion: 1,
      snapshot: buildSnapshot("_global", "sum(global_orders.amount_paid)")
    });
    await repository.publishSnapshot({
      auditSummary: "datasource baseline",
      domain: datasourceDomain,
      releaseSummary: "datasource semantic spine",
      semanticVersion: 1,
      snapshot: buildSnapshot("_ds", "sum(ds_orders.amount_paid)")
    });

    const compiled = await compiler.compile({
      datasourceId,
      domain
    });

    expect(compiled.status).toBe("ready");
    expect(compiled.evidence.matchedScope).toBe("datasource");
    expect(compiled.instructionSets.metricBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          binding: "sum(ds_orders.amount_paid)"
        })
      ])
    );
  });
});
