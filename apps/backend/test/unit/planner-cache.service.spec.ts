import { PlannerCacheService } from "../../src/modules/agent/planner/planner-cache.service";

describe("planner cache service", () => {
  it("builds cache key using datasource + query hash + semantic version", () => {
    const service = new PlannerCacheService();

    const stored = service.store({
      datasourceId: "ds-cache",
      question: "SELECT count(*) FROM orders",
      semanticVersion: 3,
      strategy: "direct_sql",
      summary: "initial"
    });

    expect(stored.cacheKey).toContain("ds-cache:");
    expect(stored.cacheKey).toContain(":v3");
  });

  it("returns cache hit for same question and semantic version", () => {
    const service = new PlannerCacheService();
    service.store({
      datasourceId: "ds-cache-hit",
      question: "orders amount",
      semanticVersion: 2,
      strategy: "direct_sql",
      summary: "hit-target"
    });

    const lookup = service.lookup({
      datasourceId: "ds-cache-hit",
      question: "orders amount",
      semanticVersion: 2
    });

    expect(lookup.status).toBe("hit");
    expect(lookup.entry?.strategy).toBe("direct_sql");
  });

  it("invalidates old-version entries when semantic version changes", () => {
    const service = new PlannerCacheService();
    service.store({
      datasourceId: "ds-cache-version",
      question: "orders amount",
      semanticVersion: 1,
      strategy: "fallback_sql",
      summary: "v1"
    });
    service.store({
      datasourceId: "ds-cache-version",
      question: "orders amount",
      semanticVersion: 2,
      strategy: "direct_sql",
      summary: "v2"
    });

    const removed = service.invalidateByDatasourceAndSemanticVersion(
      "ds-cache-version",
      2
    );
    const v1Lookup = service.lookup({
      datasourceId: "ds-cache-version",
      question: "orders amount",
      semanticVersion: 1
    });
    const v2Lookup = service.lookup({
      datasourceId: "ds-cache-version",
      question: "orders amount",
      semanticVersion: 2
    });

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(v1Lookup.status).toBe("miss");
    expect(v2Lookup.status).toBe("hit");
  });
});
