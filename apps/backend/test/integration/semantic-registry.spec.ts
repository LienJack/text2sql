import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { SemanticRegistryService } from "../../src/modules/semantic-registry/semantic-registry.service";

describe("semantic registry integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
  });

  it("allows planner-stage lookup in the same run after publishing a semantic version", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const registry = moduleRef.get(SemanticRegistryService);

    const runId = "run-semantic-registry-int-v1";
    await registry.publishVersion({
      domain: "semantic_term",
      semanticVersion: 1,
      releaseSummary: "R3 semantic release",
      auditSummary: "integration publish",
      publishedByRunId: runId,
      activatedByRunId: runId,
      activatedAt: "2026-04-18T00:00:00.000Z",
      riskTags: ["semantic_registry_release"],
      terms: [
        {
          term: "gmv",
          canonicalKey: "metric.gmv",
          definition: "gross merchandise volume",
          binding: "{\"metric\":\"sum(order_amount)\"}"
        }
      ]
    });

    const result = await registry.resolveTerm({
      domain: "semantic_term",
      term: "gmv"
    });

    expect(result.status).toBe("ready");
    expect(result.semantic_version).toBe(1);
    expect(result.term?.canonical_key).toBe("metric.gmv");
    expect(result.published_by_run_id).toBe(runId);
    expect(result.activated_by_run_id).toBe(runId);
    expect(result.risk_tags).toEqual(
      expect.arrayContaining(["semantic_registry_release"])
    );

    await moduleRef.close();
  });

  it("resolves datasource-scoped semantic term first and falls back to global scope", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const registry = moduleRef.get(SemanticRegistryService);

    await registry.publishVersion({
      domain: "semantic_term",
      semanticVersion: 1,
      releaseSummary: "global semantic release",
      auditSummary: "integration global publish",
      terms: [
        {
          term: "gmv",
          canonicalKey: "metric.gmv.global",
          definition: "global gmv",
          binding: "{\"metric\":\"sum(order_amount)\"}"
        }
      ]
    });

    const datasourceDomain = registry.buildDatasourceScopedDomain("semantic_term", "ds-semantic-a");
    await registry.publishVersion({
      domain: datasourceDomain,
      semanticVersion: 1,
      releaseSummary: "datasource semantic release",
      auditSummary: "integration datasource publish",
      terms: [
        {
          term: "gmv",
          canonicalKey: "metric.gmv.ds",
          definition: "datasource gmv",
          binding: "{\"metric\":\"sum(amount_paid)\"}"
        }
      ]
    });

    const datasourceScoped = await registry.resolveTerm({
      domain: "semantic_term",
      datasourceId: "ds-semantic-a",
      term: "GMV"
    });
    const fallbackToGlobal = await registry.resolveTerm({
      domain: "semantic_term",
      datasourceId: "ds-semantic-missing",
      term: "GMV"
    });

    expect(datasourceScoped.status).toBe("ready");
    expect(datasourceScoped.term?.canonical_key).toBe("metric.gmv.ds");
    expect(datasourceScoped.matched_scope).toBe("datasource");
    expect(fallbackToGlobal.status).toBe("ready");
    expect(fallbackToGlobal.term?.canonical_key).toBe("metric.gmv.global");
    expect(fallbackToGlobal.matched_scope).toBe("global");

    await moduleRef.close();
  });
});
