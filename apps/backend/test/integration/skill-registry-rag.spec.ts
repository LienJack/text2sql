import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagRetrievalService } from "../../src/modules/rag/retrieval/rag-retrieval.service";
import {
  SKILL_REGISTRY_UNAVAILABLE_REASON,
  SkillRegistryService,
  createDefaultSkillRegistryFixture
} from "../../src/modules/skill-registry/skill-registry.service";

describe("skill registry + rag retrieval integration", () => {
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

  it("injects skill context into retrieval bundle when term mapping is available", async () => {
    const builder = Test.createTestingModule({
      imports: [AppModule]
    });
    builder
      .overrideProvider(SkillRegistryService)
      .useValue(createDefaultSkillRegistryFixture());
    const moduleRef = await builder.compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);

    const datasourceId = "ds-skill-registry-rag-ready";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-skill-semantic",
        datasourceId,
        domain: "semantic_term",
        content: "GMV means gross merchandise volume.",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["amount"]
        })
      },
      {
        id: "chunk-skill-schema",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, created_at)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "created_at"]
        })
      }
    ]);

    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-skill-registry-rag-ready-v1",
      createdByRunId: "run-skill-registry-rag-ready-build-v1",
      activatedByRunId: "run-skill-registry-rag-ready-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "GMV",
      datasourceId,
      runId: "run-skill-registry-rag-ready-v1"
    });

    expect(response.retrieval_bundle.skill_context).toBeDefined();
    expect(response.retrieval_bundle.skill_context?.skills.map((item) => item.key)).toEqual(
      expect.arrayContaining(["metric_term_resolution", "aggregation_sql_builder"])
    );
    expect(response.retrieval_bundle.skill_context?.degrade_reason).toBeUndefined();

    await moduleRef.close();
  });

  it("keeps retrieval available and adds degrade reason when skill registry is unavailable", async () => {
    const builder = Test.createTestingModule({
      imports: [AppModule]
    });
    builder
      .overrideProvider(SkillRegistryService)
      .useValue(createDefaultSkillRegistryFixture());
    const moduleRef = await builder.compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);
    const skillRegistry = moduleRef.get(SkillRegistryService);

    jest.spyOn(skillRegistry, "resolveSkills").mockRejectedValue(new Error("registry down"));

    const datasourceId = "ds-skill-registry-rag-degrade";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-skill-degrade-schema",
        datasourceId,
        domain: "schema",
        content: "table users(id, email)",
        metadata: JSON.stringify({
          tableNames: ["users"],
          columnNames: ["id", "email"]
        })
      }
    ]);

    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-skill-registry-rag-degrade-v1",
      createdByRunId: "run-skill-registry-rag-degrade-build-v1",
      activatedByRunId: "run-skill-registry-rag-degrade-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "users email",
      datasourceId,
      runId: "run-skill-registry-rag-degrade-v1"
    });

    expect(response.retrieval_bundle.candidates.length).toBeGreaterThan(0);
    expect(response.retrieval_bundle.skill_context?.degrade_reason).toBe(
      SKILL_REGISTRY_UNAVAILABLE_REASON
    );
    expect(response.retrieval_bundle.degrade_reasons).toContain(
      SKILL_REGISTRY_UNAVAILABLE_REASON
    );

    await moduleRef.close();
  });
});
