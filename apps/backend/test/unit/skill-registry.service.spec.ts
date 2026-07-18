import {
  SKILL_REGISTRY_UNAVAILABLE_REASON,
  createDefaultSkillRegistryFixture,
  SkillRegistryService
} from "../../src/modules/skill-registry/skill-registry.service";

describe("SkillRegistryService", () => {
  it("returns mapped skills by domain and term lookup", async () => {
    const service = createDefaultSkillRegistryFixture();

    const result = await service.resolveSkills({
      domain: "semantic_term",
      term: "GMV",
      context: {
        question: "请按 GMV 趋势统计",
        tableNames: ["orders"]
      }
    });

    expect(result.degrade_reason).toBeUndefined();
    expect(result.skills.map((item) => item.key)).toEqual(
      expect.arrayContaining(["metric_term_resolution", "aggregation_sql_builder"])
    );
    expect(result.context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "skill_registry",
          domain: "semantic_term",
          term: "gmv",
          matched_by: "term"
        })
      ])
    );
  });

  it("returns empty context when no binding is matched", async () => {
    const service = createDefaultSkillRegistryFixture();

    const result = await service.resolveSkills({
      domain: "semantic_term",
      term: "unknown_metric",
      context: {
        question: "展示库存周转率"
      }
    });

    expect(result).toEqual({
      skills: [],
      context: []
    });
  });

  it("returns controlled degradation when registry lookup throws", async () => {
    const service = createDefaultSkillRegistryFixture();
    jest
      .spyOn(service as unknown as { lookupBindings: () => Promise<unknown> }, "lookupBindings")
      .mockRejectedValue(new Error("registry unavailable"));

    const result = await service.resolveSkills({
      domain: "semantic_term",
      term: "gmv",
      context: {
        question: "按 gmv 聚合"
      }
    });

    expect(result).toEqual({
      skills: [],
      context: [],
      degrade_reason: SKILL_REGISTRY_UNAVAILABLE_REASON
    });
  });
});
