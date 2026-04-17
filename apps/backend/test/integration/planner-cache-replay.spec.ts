import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { BuildPhysicalPlanNode } from "../../src/modules/agent/nodes/build-physical-plan.node";
import { PlannerCacheService } from "../../src/modules/agent/planner/planner-cache.service";

describe("planner cache replay integration", () => {
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

  it("uses planner cache on repeated same-input same-version requests", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const physicalNode = moduleRef.get(BuildPhysicalPlanNode);

    const semanticPlan = {
      status: "ready" as const,
      semanticHints: ["use_metric_aliases"],
      semanticVersion: 1,
      lockStatus: "locked" as const,
      fallbackApplied: false,
      riskTags: [],
      summary: "semantic ready"
    };

    const first = await physicalNode.run({
      semanticPlan,
      question: "gmv trend",
      datasourceId: "ds-planner-cache-hit"
    });
    const second = await physicalNode.run({
      semanticPlan,
      question: "gmv trend",
      datasourceId: "ds-planner-cache-hit"
    });

    expect(first.cacheStatus).toBe("miss");
    expect(second.cacheStatus).toBe("hit");
    expect(second.strategy).toBe("direct_sql");

    await moduleRef.close();
  });

  it("invalidates old semantic-version cache entries on version switch", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const physicalNode = moduleRef.get(BuildPhysicalPlanNode);
    const cacheService = moduleRef.get(PlannerCacheService);

    await physicalNode.run({
      semanticPlan: {
        status: "ready",
        semanticHints: [],
        semanticVersion: 1,
        lockStatus: "locked",
        fallbackApplied: false,
        riskTags: [],
        summary: "v1"
      },
      question: "orders amount",
      datasourceId: "ds-planner-cache-invalidate"
    });

    await physicalNode.run({
      semanticPlan: {
        status: "ready",
        semanticHints: [],
        semanticVersion: 2,
        lockStatus: "locked",
        fallbackApplied: false,
        riskTags: [],
        summary: "v2"
      },
      question: "orders amount",
      datasourceId: "ds-planner-cache-invalidate"
    });

    const v1 = cacheService.lookup({
      datasourceId: "ds-planner-cache-invalidate",
      question: "orders amount",
      semanticVersion: 1
    });
    const v2 = cacheService.lookup({
      datasourceId: "ds-planner-cache-invalidate",
      question: "orders amount",
      semanticVersion: 2
    });

    expect(v1.status).toBe("miss");
    expect(v2.status).toBe("hit");

    await moduleRef.close();
  });
});
