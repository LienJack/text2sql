import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { BuildPhysicalPlanNode } from "../../src/modules/agent/nodes/build-physical-plan.node";
import { BuildSemanticQueryNode } from "../../src/modules/agent/nodes/build-semantic-query.node";
import { SemanticRegistryService } from "../../src/modules/semantic-registry/semantic-registry.service";

describe("planner version lock integration", () => {
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

  it("locks requested semantic version and keeps direct strategy", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const registry = moduleRef.get(SemanticRegistryService);
    const semanticNode = moduleRef.get(BuildSemanticQueryNode);
    const physicalNode = moduleRef.get(BuildPhysicalPlanNode);

    await registry.publishVersion({
      domain: "semantic_term",
      semanticVersion: 1,
      releaseSummary: "v1",
      auditSummary: "planner lock ready",
      terms: [
        {
          term: "gmv",
          canonicalKey: "metric.gmv",
          definition: "Gross merchandise volume",
          binding: "{\"metric\":\"sum(order_amount)\"}"
        }
      ]
    });

    const semanticPlan = await semanticNode.run({
      intentPlan: {
        status: "ready",
        intent: "aggregate",
        constraints: [],
        summary: "intent ready"
      },
      question: "gmv"
    });
    const physicalPlan = await physicalNode.run({
      semanticPlan,
      question: "gmv",
      datasourceId: "ds-planner-lock-ready"
    });

    expect(semanticPlan.lockStatus).toBe("locked");
    expect(semanticPlan.semanticVersion).toBe(1);
    expect(physicalPlan.strategy).toBe("direct_sql");
    expect(physicalPlan.status).toBe("ready");

    await moduleRef.close();
  });

  it("falls back to stable semantic version when requested version is missing", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const registry = moduleRef.get(SemanticRegistryService);
    const semanticNode = moduleRef.get(BuildSemanticQueryNode);
    const physicalNode = moduleRef.get(BuildPhysicalPlanNode);

    await registry.publishVersion({
      domain: "semantic_term",
      semanticVersion: 1,
      releaseSummary: "v1",
      auditSummary: "planner lock fallback",
      terms: [
        {
          term: "gmv",
          canonicalKey: "metric.gmv",
          definition: "Gross merchandise volume",
          binding: "{\"metric\":\"sum(order_amount)\"}"
        }
      ]
    });

    const semanticPlan = await semanticNode.run({
      intentPlan: {
        status: "ready",
        intent: "aggregate",
        constraints: [],
        summary: "intent ready"
      },
      question: "gmv",
      requestedSemanticVersion: 9
    });
    const physicalPlan = await physicalNode.run({
      semanticPlan,
      question: "gmv",
      datasourceId: "ds-planner-lock-fallback"
    });

    expect(semanticPlan.lockStatus).toBe("fallback");
    expect(semanticPlan.fallbackApplied).toBe(true);
    expect(semanticPlan.semanticVersion).toBe(1);
    expect(physicalPlan.strategy).toBe("fallback_sql");
    expect(physicalPlan.status).toBe("degraded");

    await moduleRef.close();
  });
});
