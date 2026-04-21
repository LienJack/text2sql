import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { BuildPhysicalPlanNode } from "../../src/modules/conversation/agent/nodes/build-physical-plan.node";
import { BuildSemanticQueryNode } from "../../src/modules/conversation/agent/nodes/build-semantic-query.node";
import { SemanticRegistryService } from "../../src/modules/semantic-registry/semantic-registry.service";

describe("r3 gate rehearsal", () => {
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

  it("replays fallback path with semantic rollback and planner cache stabilization", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const registry = moduleRef.get(SemanticRegistryService);
    const semanticNode = moduleRef.get(BuildSemanticQueryNode);
    const physicalNode = moduleRef.get(BuildPhysicalPlanNode);

    await registry.publishVersion({
      domain: "semantic_term",
      semanticVersion: 1,
      releaseSummary: "R3 release v1",
      auditSummary: "r3 gate rehearsal",
      terms: [
        {
          term: "gmv",
          canonicalKey: "metric.gmv",
          definition: "Gross merchandise volume",
          binding: "{\"metric\":\"sum(order_amount)\"}"
        }
      ],
      riskTags: ["r3_rehearsal"]
    });

    const semanticPlan = await semanticNode.run({
      intentPlan: {
        status: "ready",
        intent: "aggregate",
        constraints: ["must_use_selected_context"],
        summary: "intent ready"
      },
      question: "gmv trend",
      requestedSemanticVersion: 999,
      retrievalBundle: {
        query: "gmv trend",
        run_id: "run-r3-rehearsal",
        datasource_id: "ds-r3-rehearsal",
        status: "ready",
        degrade_reasons: [],
        lane_results: {
          lexical: { lane: "lexical", status: "ok", timeout_ms: 200, elapsed_ms: 20, hits: [] },
          dense: { lane: "dense", status: "ok", timeout_ms: 200, elapsed_ms: 25, hits: [] },
          graph: { lane: "graph", status: "ok", timeout_ms: 200, elapsed_ms: 22, hits: [] }
        },
        candidates: [],
        skill_context: {
          skills: [],
          context: [
            {
              source: "skill_registry",
              domain: "semantic_term",
              term: "gmv",
              matched_by: "term"
            }
          ]
        }
      }
    });

    const firstPhysical = await physicalNode.run({
      semanticPlan,
      question: "gmv trend",
      datasourceId: "ds-r3-rehearsal"
    });
    const secondPhysical = await physicalNode.run({
      semanticPlan,
      question: "gmv trend",
      datasourceId: "ds-r3-rehearsal"
    });

    expect(semanticPlan.lockStatus).toBe("fallback");
    expect(semanticPlan.fallbackApplied).toBe(true);
    expect(semanticPlan.semanticVersion).toBe(1);
    expect(semanticPlan.riskTags).toEqual(expect.arrayContaining(["r3_rehearsal"]));
    expect(firstPhysical.cacheStatus).toBe("miss");
    expect(secondPhysical.cacheStatus).toBe("hit");
    expect(secondPhysical.strategy).toBe("fallback_sql");

    await moduleRef.close();
  });
});
