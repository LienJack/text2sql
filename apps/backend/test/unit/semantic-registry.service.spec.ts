import { SemanticRegistryService } from "../../src/modules/semantic-registry/semantic-registry.service";
import type { AppConfigService } from "../../src/modules/config/app-config.service";
import {
  SEMANTIC_REGISTRY_DEGRADED_RISK_TAG,
  SEMANTIC_TERM_NOT_FOUND_REASON,
  SEMANTIC_VERSION_NOT_FOUND_REASON
} from "../../src/modules/semantic-registry/semantic-registry.service";

const createService = () =>
  new SemanticRegistryService(
    {
      databaseUrl: ""
    } as AppConfigService
  );

describe("semantic registry service", () => {
  it("publishes a semantic version and resolves term with explicit version", async () => {
    const service = createService();

    await service.publishVersion({
      domain: "semantic_term",
      semanticVersion: 1,
      releaseSummary: "r3 semantic baseline",
      auditSummary: "unit publish",
      terms: [
        {
          term: "gmv",
          canonicalKey: "metric.gmv",
          definition: "Gross merchandise volume",
          binding: "{\"metric\":\"sum(order_amount)\"}"
        }
      ],
      riskTags: ["semantic_registry_v1_ready"]
    });

    const result = await service.resolveTerm({
      domain: "semantic_term",
      term: "GMV",
      semanticVersion: 1
    });

    expect(result.status).toBe("ready");
    expect(result.semantic_version).toBe(1);
    expect(result.term?.canonical_key).toBe("metric.gmv");
    expect(result.risk_tags).toEqual(
      expect.arrayContaining(["semantic_registry_v1_ready"])
    );
  });

  it("defaults to active version but supports stable old-version read", async () => {
    const service = createService();

    await service.publishVersion({
      domain: "semantic_term",
      semanticVersion: 1,
      releaseSummary: "v1",
      auditSummary: "seed v1",
      terms: [
        {
          term: "gmv",
          canonicalKey: "metric.gmv.v1",
          definition: "GMV v1",
          binding: "{\"metric\":\"sum(order_amount)\"}"
        }
      ]
    });
    await service.publishVersion({
      domain: "semantic_term",
      semanticVersion: 2,
      releaseSummary: "v2",
      auditSummary: "seed v2",
      terms: [
        {
          term: "gmv",
          canonicalKey: "metric.gmv.v2",
          definition: "GMV v2",
          binding: "{\"metric\":\"sum(amount_paid)\"}"
        }
      ]
    });

    const active = await service.resolveTerm({
      domain: "semantic_term",
      term: "gmv"
    });
    const oldVersion = await service.resolveTerm({
      domain: "semantic_term",
      term: "gmv",
      semanticVersion: 1
    });

    expect(active.status).toBe("ready");
    expect(active.semantic_version).toBe(2);
    expect(active.term?.canonical_key).toBe("metric.gmv.v2");
    expect(oldVersion.status).toBe("ready");
    expect(oldVersion.semantic_version).toBe(1);
    expect(oldVersion.term?.canonical_key).toBe("metric.gmv.v1");
  });

  it("returns controlled degraded result for missing version or term", async () => {
    const service = createService();

    await service.publishVersion({
      domain: "schema",
      semanticVersion: 1,
      releaseSummary: "schema-v1",
      auditSummary: "seed schema",
      terms: [
        {
          term: "orders",
          canonicalKey: "table.orders",
          definition: "orders table",
          binding: "{\"table\":\"orders\"}"
        }
      ]
    });

    const missingVersion = await service.resolveTerm({
      domain: "schema",
      term: "orders",
      semanticVersion: 9
    });
    const missingTerm = await service.resolveTerm({
      domain: "schema",
      term: "payments",
      semanticVersion: 1
    });

    expect(missingVersion.status).toBe("degraded");
    expect(missingVersion.degrade_reason).toBe(SEMANTIC_VERSION_NOT_FOUND_REASON);
    expect(missingVersion.risk_tags).toContain(SEMANTIC_REGISTRY_DEGRADED_RISK_TAG);
    expect(missingTerm.status).toBe("degraded");
    expect(missingTerm.degrade_reason).toBe(SEMANTIC_TERM_NOT_FOUND_REASON);
    expect(missingTerm.risk_tags).toContain(SEMANTIC_REGISTRY_DEGRADED_RISK_TAG);
  });

  it("resolves datasource-scoped domain first and falls back to global", async () => {
    const service = createService();
    const datasourceScopedDomain = service.buildDatasourceScopedDomain(
      "semantic_term",
      "ds-semantic-unit"
    );

    await service.publishVersion({
      domain: "semantic_term",
      semanticVersion: 1,
      releaseSummary: "global semantic v1",
      auditSummary: "global baseline",
      terms: [
        {
          term: "gmv",
          canonicalKey: "metric.gmv.global",
          definition: "global gmv",
          binding: "{\"metric\":\"sum(order_amount)\"}"
        }
      ]
    });
    await service.publishVersion({
      domain: datasourceScopedDomain,
      semanticVersion: 1,
      releaseSummary: "ds semantic v1",
      auditSummary: "datasource baseline",
      terms: [
        {
          term: "gmv",
          canonicalKey: "metric.gmv.datasource",
          definition: "datasource gmv",
          binding: "{\"metric\":\"sum(amount_paid)\"}"
        }
      ]
    });

    const datasourceHit = await service.resolveTerm({
      domain: "semantic_term",
      datasourceId: "ds-semantic-unit",
      term: "gmv"
    });
    const globalFallback = await service.resolveTerm({
      domain: "semantic_term",
      datasourceId: "ds-semantic-other",
      term: "gmv"
    });

    expect(datasourceHit.status).toBe("ready");
    expect(datasourceHit.term?.canonical_key).toBe("metric.gmv.datasource");
    expect(datasourceHit.matched_scope).toBe("datasource");
    expect(globalFallback.status).toBe("ready");
    expect(globalFallback.term?.canonical_key).toBe("metric.gmv.global");
    expect(globalFallback.matched_scope).toBe("global");
  });
});
