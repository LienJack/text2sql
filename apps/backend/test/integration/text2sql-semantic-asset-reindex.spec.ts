import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import {
  SemanticAssetReindexService,
  type SemanticAssetReindexTrigger
} from "../../src/modules/knowledge/rag/retrieval/semantic-asset-reindex.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";

describe("text2sql semantic asset reindex integration", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.NODE_ENV = "test";
    process.env.LLM_MOCK_MODE = "true";
    process.env.EMBEDDING_MOCK_MODE = "true";
    process.env.EMBEDDING_PROVIDER = "volcengine";
    process.env.EMBEDDING_MODEL = "embedding-v2";
    process.env.EMBEDDING_VECTOR_VERSION = "v3";
  });

  it("reindexes semantic assets with trigger-mapped source version", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const service = moduleRef.get(SemanticAssetReindexService);
    const repository = moduleRef.get(RagIndexRepository);

    repository.seedChunksForDatasource("sqlite_main", [
      {
        id: "chunk-semantic-asset-reindex-orders",
        datasourceId: "sqlite_main",
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status"]
        })
      }
    ]);

    const triggers: SemanticAssetReindexTrigger[] = ["schema", "embedding_model", "examples"];
    const result = await service.reindex({
      datasourceId: "sqlite_main",
      workspaceId: "ws-semantic-reindex",
      triggers,
      reason: "unit2_contract_refresh",
      runId: "run-semantic-asset-reindex-v1"
    });

    expect(result.status).toBe("reindexed");
    expect(result.indexVersionId).toBeDefined();
    expect(result.lifecycle.status).toBe("activated");
    expect(result.lifecycle.latestManifestFingerprint).toBe(result.semanticAssetVersion);
    expect(result.lifecycle.rebuildable).toBe(false);
    expect(result.semanticAssetVersion).toContain("semantic-assets-");
    expect(result.manifestSummary.fingerprint).toBe(result.semanticAssetVersion);
    expect(result.manifestSummary.entryCount).toBe(3);
    expect(result.manifestSummary.familyCounts).toMatchObject({
      full_schema: 1,
      prior_question_sql: 1,
      project_metadata: 1
    });
    expect(result.manifestSummary.preparedEntryCount).toBe(3);
    expect(result.sourceVersion).toContain("embedding_model");
    expect(result.sourceVersion).toContain(result.manifestSummary.fingerprint);
    expect(result.embeddingProfile.provider).toBe("volcengine");
    expect(result.embeddingProfile.model).toBe("embedding-v2");
    expect(result.embeddingProfile.vectorVersion).toBe("v3");
    expect(result.triggerSummary.schema).toBe(true);
    expect(result.triggerSummary.embedding_model).toBe(true);
    expect(result.triggerSummary.examples).toBe(true);

    await moduleRef.close();
  });

  it("builds active index entries from manifest typed chunk inputs", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const service = moduleRef.get(SemanticAssetReindexService);
    const repository = moduleRef.get(RagIndexRepository);

    const result = await service.reindex({
      datasourceId: "ds-semantic-manifest-chunks",
      workspaceId: "ws-semantic-reindex",
      triggers: ["schema"],
      reason: "unit3_manifest_build",
      runId: "run-semantic-asset-reindex-manifest-build",
      sourceSnapshots: [
        {
          family: "table_description",
          sourceKind: "datasource_schema",
          sourceRef: { type: "datasource_schema", ref: "orders.description" },
          sourceVersion: "schema-v3",
          sourceHash: "hash-orders-description-v3",
          tableName: "orders",
          content: "Orders table stores paid and pending order facts.",
          summary: { description: "Paid and pending order facts" }
        }
      ]
    });

    expect(result.status).toBe("reindexed");
    expect(result.preparedSourceCount).toBe(1);
    expect(result.typedChunkInputCount).toBe(1);
    expect(result.entryCount).toBe(1);

    const active = await repository.getActiveVersion("ds-semantic-manifest-chunks");
    expect(active?.id).toBe(result.indexVersionId);
    expect(active?.sourceVersion).toContain(result.semanticAssetVersion);

    const entries = await repository.listEntriesByVersion(result.indexVersionId ?? "");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.domain).toBe("semantic_asset");
    const metadata = JSON.parse(entries[0]?.metadata ?? "{}");
    expect(metadata.sourceMetadata).toEqual(
      expect.objectContaining({
        assetFamily: "table_description",
        manifestFingerprint: result.semanticAssetVersion,
        preparationStatus: "prepared",
        sourceVersion: "schema-v3",
        visibilityScope: "datasource"
      })
    );

    await moduleRef.close();
  });

  it("skips reindex when the same source version is already active", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const service = moduleRef.get(SemanticAssetReindexService);
    const repository = moduleRef.get(RagIndexRepository);

    repository.seedChunksForDatasource("sqlite_main", [
      {
        id: "chunk-semantic-asset-reindex-orders-2",
        datasourceId: "sqlite_main",
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status"]
        })
      }
    ]);

    const request = {
      datasourceId: "sqlite_main",
      workspaceId: "ws-semantic-reindex",
      triggers: ["schema", "embedding_model"] as SemanticAssetReindexTrigger[],
      reason: "unit2_contract_refresh",
      runId: "run-semantic-asset-reindex-v2"
    };

    const first = await service.reindex(request);
    const second = await service.reindex(request);

    expect(first.status).toBe("reindexed");
    expect(second.status).toBe("skipped");
    expect(second.lifecycle.status).toBe("already_active");
    expect(second.lifecycle.activeIndexVersionId).toBe(first.indexVersionId);
    expect(second.reasonCodes).toContain("skip:already_active");
    expect(second.manifestSummary.fingerprint).toBe(second.semanticAssetVersion);
    expect(second.manifestSummary.familyCounts).toMatchObject({
      full_schema: 1,
      project_metadata: 1
    });

    await moduleRef.close();
  });

  it("reports stale rebuildable lifecycle before replacing an old active manifest", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const service = moduleRef.get(SemanticAssetReindexService);

    const datasourceId = "ds-semantic-manifest-stale";
    const first = await service.reindex({
      datasourceId,
      workspaceId: "ws-semantic-reindex",
      triggers: ["schema"],
      reason: "unit3_manifest_stale_v1",
      runId: "run-semantic-asset-reindex-stale-v1",
      sourceSnapshots: [
        {
          family: "table_description",
          sourceKind: "datasource_schema",
          sourceRef: { type: "datasource_schema", ref: "orders.description" },
          sourceVersion: "schema-v1",
          sourceHash: "hash-orders-description-v1",
          tableName: "orders",
          content: "Orders table stores order facts."
        }
      ]
    });
    const second = await service.reindex({
      datasourceId,
      workspaceId: "ws-semantic-reindex",
      triggers: ["schema"],
      reason: "unit3_manifest_stale_v2",
      runId: "run-semantic-asset-reindex-stale-v2",
      sourceSnapshots: [
        {
          family: "table_description",
          sourceKind: "datasource_schema",
          sourceRef: { type: "datasource_schema", ref: "orders.description" },
          sourceVersion: "schema-v2",
          sourceHash: "hash-orders-description-v2",
          tableName: "orders",
          content: "Orders table stores paid order facts."
        }
      ]
    });

    expect(first.status).toBe("reindexed");
    expect(second.status).toBe("reindexed");
    expect(second.lifecycle.status).toBe("activated");
    expect(second.lifecycle.previousActiveIndexVersionId).toBe(first.indexVersionId);
    expect(second.lifecycle.activeManifestFingerprint).toBe(first.semanticAssetVersion);
    expect(second.lifecycle.staleReasons).toContain("stale_source_version");

    await moduleRef.close();
  });

  it("returns manifest skip evidence when no reindex triggers are present", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const service = moduleRef.get(SemanticAssetReindexService);

    const result = await service.reindex({
      datasourceId: "sqlite_main",
      workspaceId: "ws-semantic-reindex",
      triggers: [],
      reason: "empty_trigger_guard",
      runId: "run-semantic-asset-reindex-empty"
    });

    expect(result.status).toBe("skipped");
    expect(result.reasonCodes).toContain("skip:no_triggers");
    expect(result.manifestSummary.entryCount).toBe(0);
    expect(result.manifestSummary.reasonCodes).toContain("skipped_no_triggers");
    expect(result.manifestSummary.fingerprint).toBe(result.semanticAssetVersion);

    await moduleRef.close();
  });
});
