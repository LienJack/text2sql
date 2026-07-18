import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { RagIndexBuilderService } from "../../src/modules/rag/index/rag-index-builder.service";
import { RagIndexRepository } from "../../src/modules/rag/index/rag-index.repository";
import { RagReplayRepository } from "../../src/modules/knowledge/rag/observability/rag-replay.repository";
import { RagRetrievalService } from "../../src/modules/knowledge/rag/retrieval/rag-retrieval.service";
import { ModelingGraphRepository } from "../../src/modules/platform/data/persistence/modeling-graph.repository";

describe("rag retrieval service integration", () => {
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

  it("fails closed before lane retrieval when trusted SQL grounding is incomplete", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const retrievalService = moduleRef.get(RagRetrievalService);

    const response = await retrievalService.retrieve({
      query: "统计订单金额",
      datasourceId: "ds-trusted-grounding-missing",
      runId: "run-trusted-grounding-missing",
      workspaceId: "ws-1",
      allowedTables: ["orders"],
      requiresSqlPolicy: true,
      policyVersion: 1,
      policyDigest: "policy-1"
    });

    expect(response.retrieval_bundle.status).toBe("degraded");
    expect(response.retrieval_bundle.candidates).toEqual([]);
    expect(response.retrieval_bundle.selected_context).toEqual([]);
    expect(response.retrieval_bundle.degrade_reasons).toEqual([
      "trusted_sql_grounding_unavailable"
    ]);
    expect(response.retrieval_bundle.permission_filtering).toMatchObject({
      status: "skipped",
      kept_candidate_count: 0
    });
    await moduleRef.close();
  });

  it("returns reproducible candidates and keeps domain coverage across schema/sql_example/semantic_term", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);
    const replayRepository = moduleRef.get(RagReplayRepository);

    const datasourceId = "ds-rag-retrieval-coverage";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-schema-orders",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status, created_at)",
        metadata: JSON.stringify({
          chunkProfile: "schema_table",
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status", "created_at"]
        })
      },
      {
        id: "chunk-sql-orders",
        datasourceId,
        domain: "sql_example",
        content: "SELECT SUM(amount) FROM orders WHERE status = 'paid'",
        metadata: JSON.stringify({
          chunkProfile: "sql_example",
          tableNames: ["orders"],
          columnNames: ["amount", "status"]
        })
      },
      {
        id: "chunk-semantic-gmv",
        datasourceId,
        domain: "semantic_term",
        content: "GMV means gross merchandise volume and maps to order amount.",
        metadata: JSON.stringify({
          chunkProfile: "semantic_term",
          tableNames: ["orders"],
          columnNames: ["amount"]
        })
      }
    ]);

    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-v1",
      createdByRunId: "run-rag-retrieval-build-v1",
      activatedByRunId: "run-rag-retrieval-build-v1"
    });

    const first = await retrievalService.retrieve({
      query: "orders amount GMV",
      datasourceId,
      runId: "run-rag-retrieval-v1",
      perLaneLimit: 10,
      finalCandidateLimit: 10
    });
    const second = await retrievalService.retrieve({
      query: "orders amount GMV",
      datasourceId,
      runId: "run-rag-retrieval-v2",
      perLaneLimit: 10,
      finalCandidateLimit: 10
    });

    const firstIds = first.retrieval_bundle.candidates.map((item) => item.chunk_id);
    const secondIds = second.retrieval_bundle.candidates.map((item) => item.chunk_id);
    const coveredDomains = new Set(
      first.retrieval_bundle.candidates.map((item) => item.chunk.metadata.domain)
    );

    expect(first.retrieval_bundle.index_version_id).toBeTruthy();
    expect(first.retrieval_bundle.lane_results.lexical.status).toBe("ok");
    expect(first.retrieval_bundle.lane_results.dense.status).toBe("ok");
    expect(first.retrieval_bundle.lane_results.graph.status).toBe("ok");
    expect(first.retrieval_bundle.context_pack).toBeDefined();
    expect(first.retrieval_bundle.context_pack?.status).toBe(first.retrieval_bundle.status);
    expect(first.retrieval_bundle.context_pack?.semantic_lock_status).toBe(
      first.retrieval_bundle.status === "ready" ? "locked" : "degraded"
    );
    expect(firstIds.length).toBeGreaterThan(0);
    expect(firstIds).toEqual(secondIds);
    expect(coveredDomains.has("schema")).toBe(true);
    expect(coveredDomains.has("sql_example")).toBe(true);
    expect(coveredDomains.has("semantic_term")).toBe(true);

    const replayEvents = await replayRepository.listByRunId("run-rag-retrieval-v1");
    expect(replayEvents.some((item) => item.replayKey === "retrieval:lane:lexical")).toBe(
      true
    );
    expect(replayEvents.some((item) => item.replayKey === "retrieval:lane:dense")).toBe(
      true
    );
    expect(replayEvents.some((item) => item.replayKey === "retrieval:lane:graph")).toBe(
      true
    );
    expect(replayEvents.some((item) => item.replayKey === "retrieval:fused")).toBe(true);

    await moduleRef.close();
  });

  it("degrades a timed-out lane but still returns candidates from healthy lanes", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);

    const datasourceId = "ds-rag-retrieval-timeout";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-timeout-schema",
        datasourceId,
        domain: "schema",
        content: "table users(id, email, created_at)"
      },
      {
        id: "chunk-timeout-sql",
        datasourceId,
        domain: "sql_example",
        content: "SELECT COUNT(*) FROM users"
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-timeout-v1",
      createdByRunId: "run-rag-retrieval-timeout-build-v1",
      activatedByRunId: "run-rag-retrieval-timeout-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "users count",
      datasourceId,
      runId: "run-rag-retrieval-timeout-v1",
      laneTimeoutMs: {
        dense: 1
      },
      laneArtificialDelayMs: {
        dense: 20
      }
    });

    expect(response.retrieval_bundle.lane_results.dense.status).toBe("degraded");
    expect(response.retrieval_bundle.degrade_reasons).toEqual(
      expect.arrayContaining(["dense_timeout"])
    );
    expect(response.retrieval_bundle.context_pack?.status).toBe("degraded");
    expect(response.retrieval_bundle.context_pack?.degrade_reasons).toEqual(
      expect.arrayContaining(["dense_timeout"])
    );
    expect(response.retrieval_bundle.candidates.length).toBeGreaterThan(0);

    await moduleRef.close();
  });

  it("marks dense lane unavailable when index/query vector spaces are incompatible", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);

    const datasourceId = "ds-rag-retrieval-dense-incompatible";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-dense-incompatible-schema",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status)"
      },
      {
        id: "chunk-dense-incompatible-sql",
        datasourceId,
        domain: "sql_example",
        content: "SELECT SUM(amount) FROM orders"
      }
    ]);
    const build = await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-dense-incompatible-v1",
      createdByRunId: "run-rag-retrieval-dense-incompatible-build-v1",
      activatedByRunId: "run-rag-retrieval-dense-incompatible-build-v1"
    });
    const indexedEntries = await indexRepository.listEntriesByVersion(build.indexVersionId);
    await indexRepository.replaceEntriesForVersion(
      build.indexVersionId,
      indexedEntries.map((entry) => {
        const metadata = JSON.parse(entry.metadata ?? "{}") as Record<string, unknown>;
        const dense = ((metadata.dense as Record<string, unknown> | undefined) ?? {});
        return {
          ...entry,
          metadata: JSON.stringify({
            ...metadata,
            dense: {
              ...dense,
              dimensions: 999
            }
          })
        };
      })
    );

    const response = await retrievalService.retrieve({
      query: "orders amount",
      datasourceId,
      runId: "run-rag-retrieval-dense-incompatible-v1"
    });

    expect(response.retrieval_bundle.lane_results.dense.status).toBe("degraded");
    expect(response.retrieval_bundle.degrade_reasons).toEqual(
      expect.arrayContaining(["dense_unavailable_incompatible_vector_space"])
    );

    await moduleRef.close();
  });

  it("marks trusted prior SQL as hit and promotes it into retrieval candidates", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);
    const replayRepository = moduleRef.get(RagReplayRepository);

    const datasourceId = "ds-rag-retrieval-prior-sql-hit";
    const workspaceId = "ws-rag-prior-hit";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-prior-hit-schema",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status"]
        })
      },
      {
        id: "chunk-prior-hit-sql",
        datasourceId,
        domain: "sql_example",
        content: "SELECT SUM(amount) FROM orders WHERE status = 'paid'",
        metadata: JSON.stringify({
          trusted: true,
          priorSql: true,
          workspaceId,
          tableNames: ["orders"],
          columnNames: ["amount", "status"]
        })
      },
      {
        id: "chunk-prior-hit-semantic",
        datasourceId,
        domain: "semantic_term",
        content: "GMV maps to SUM(amount) for paid orders.",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["amount"]
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-prior-sql-hit-v1",
      createdByRunId: "run-rag-retrieval-prior-sql-hit-build-v1",
      activatedByRunId: "run-rag-retrieval-prior-sql-hit-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "orders paid gmv",
      datasourceId,
      workspaceId,
      allowedTables: ["orders"],
      runId: "run-rag-retrieval-prior-sql-hit-v1"
    });

    const priorSqlLane = response.retrieval_bundle.prior_sql_lane;
    expect(priorSqlLane).toBeDefined();
    expect(priorSqlLane?.status).toBe("hit");
    expect(priorSqlLane?.matched_count).toBe(1);
    expect(priorSqlLane?.selected_count).toBe(1);
    expect(response.retrieval_bundle.candidates[0]?.chunk_id).toBe("chunk-prior-hit-sql");
    expect(response.retrieval_bundle.candidates[0]?.evidence).toEqual(
      expect.arrayContaining(["prior_sql:trusted"])
    );

    const replayEvents = await replayRepository.listByRunId("run-rag-retrieval-prior-sql-hit-v1");
    const fusedReplay = replayEvents.find((item) => item.replayKey === "retrieval:fused");
    expect(fusedReplay).toBeDefined();
    const fusedPayload = JSON.parse(fusedReplay?.payload ?? "{}") as {
      priorSqlLane?: { status?: string; selectedCount?: number };
    };
    expect(fusedPayload.priorSqlLane?.status).toBe("hit");
    expect(fusedPayload.priorSqlLane?.selectedCount).toBe(1);

    await moduleRef.close();
  });

  it("filters trusted prior SQL by workspace and allowed tables while preserving fallback candidates", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);

    const datasourceId = "ds-rag-retrieval-prior-sql-filtered";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-prior-filter-schema",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status)",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status"]
        })
      },
      {
        id: "chunk-prior-filter-workspace",
        datasourceId,
        domain: "sql_example",
        content: "SELECT SUM(amount) FROM orders WHERE status = 'paid'",
        metadata: JSON.stringify({
          trusted: true,
          priorSql: true,
          workspaceId: "workspace-other",
          tableNames: ["orders"],
          columnNames: ["amount", "status"]
        })
      },
      {
        id: "chunk-prior-filter-tables",
        datasourceId,
        domain: "sql_example",
        content: "SELECT COUNT(*) FROM secret_orders",
        metadata: JSON.stringify({
          trusted: true,
          verified: true,
          workspaceId: "workspace-current",
          tableNames: ["secret_orders"],
          columnNames: ["id"]
        })
      },
      {
        id: "chunk-prior-filter-semantic",
        datasourceId,
        domain: "semantic_term",
        content: "GMV maps to order amount.",
        metadata: JSON.stringify({
          tableNames: ["orders"],
          columnNames: ["amount"]
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-prior-sql-filtered-v1",
      createdByRunId: "run-rag-retrieval-prior-sql-filtered-build-v1",
      activatedByRunId: "run-rag-retrieval-prior-sql-filtered-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "orders paid gmv",
      datasourceId,
      workspaceId: "workspace-current",
      allowedTables: ["orders"],
      runId: "run-rag-retrieval-prior-sql-filtered-v1"
    });

    const priorSqlLane = response.retrieval_bundle.prior_sql_lane;
    expect(priorSqlLane).toBeDefined();
    expect(priorSqlLane?.status).toBe("filtered");
    expect(priorSqlLane?.matched_count).toBe(1);
    expect(priorSqlLane?.selected_count).toBe(0);
    expect(priorSqlLane?.filtered_count).toBe(1);
    expect(priorSqlLane?.degrade_reasons).toEqual(
      expect.arrayContaining(["prior_sql_filtered_workspace_mismatch"])
    );
    expect(response.retrieval_bundle.permission_filtering).toMatchObject(
      expect.objectContaining({
        denied_evidence_ids: expect.arrayContaining(["chunk-prior-filter-tables"]),
        reason_codes: expect.arrayContaining(["permission_filtered_before_ranking"])
      })
    );
    expect(
      response.retrieval_bundle.candidates.some(
        (item) => item.chunk_id === "chunk-prior-filter-workspace"
      )
    ).toBe(false);
    expect(
      response.retrieval_bundle.candidates.some(
        (item) => item.chunk_id === "chunk-prior-filter-tables"
      )
    ).toBe(false);
    expect(response.retrieval_bundle.candidates.length).toBeGreaterThan(0);
    expect(response.retrieval_bundle.lane_results.lexical.status).toBe("ok");
    expect(response.retrieval_bundle.lane_results.dense.status).toBe("ok");
    expect(response.retrieval_bundle.lane_results.graph.status).toBe("ok");

    await moduleRef.close();
  });

  it("filters permission-scoped semantic assets before lane ranking and fusion", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);

    const datasourceId = "ds-rag-retrieval-permission-pre-rank";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-allowed-orders-description",
        datasourceId,
        domain: "semantic_asset",
        content: "Orders table contains amount and status facts.",
        metadata: JSON.stringify({
          assetFamily: "table_description",
          manifestFingerprint: "semantic-assets-permission-v1",
          manifestEntryId: "entry-orders-description",
          sourceVersion: "schema-v1",
          tableNames: ["orders"],
          columnNames: ["amount", "status"],
          visibilityScope: "table_permissions",
          preparationStatus: "prepared"
        })
      },
      {
        id: "chunk-forbidden-secret-description",
        datasourceId,
        domain: "semantic_asset",
        content: "secret_orders contains confidential revenue and margin facts.",
        metadata: JSON.stringify({
          assetFamily: "table_description",
          manifestFingerprint: "semantic-assets-permission-v1",
          manifestEntryId: "entry-secret-description",
          sourceVersion: "schema-v1",
          tableNames: ["secret_orders"],
          columnNames: ["revenue", "margin"],
          visibilityScope: "table_permissions",
          preparationStatus: "prepared"
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "semantic-assets-permission-v1:mock",
      createdByRunId: "run-rag-retrieval-permission-build-v1",
      activatedByRunId: "run-rag-retrieval-permission-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "secret_orders revenue orders amount",
      datasourceId,
      allowedTables: ["orders"],
      runId: "run-rag-retrieval-permission-pre-rank-v1"
    });

    const laneHitIds = Object.values(response.retrieval_bundle.lane_results).flatMap((lane) =>
      lane.hits.map((hit) => hit.chunk_id)
    );
    expect(laneHitIds).not.toContain("chunk-forbidden-secret-description");
    expect(response.retrieval_bundle.candidates.map((item) => item.chunk_id)).not.toContain(
      "chunk-forbidden-secret-description"
    );
    expect(response.retrieval_bundle.candidates[0]?.chunk.metadata).toEqual(
      expect.objectContaining({
        assetFamily: "table_description",
        manifestFingerprint: "semantic-assets-permission-v1",
        sourceVersion: "schema-v1"
      })
    );
    expect(response.retrieval_bundle.permission_filtering).toMatchObject({
      status: "applied",
      denied_evidence_ids: ["chunk-forbidden-secret-description"],
      reason_codes: expect.arrayContaining([
        "permission_filtered_before_ranking",
        "permission_filtered_not_in_allowed_tables"
      ])
    });

    await moduleRef.close();
  });

  it("supplements table-description-first recall with schema and relationship asset families", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);
    const replayRepository = moduleRef.get(RagReplayRepository);

    const datasourceId = "ds-rag-retrieval-two-pass-schema";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-two-pass-orders-description",
        datasourceId,
        domain: "semantic_asset",
        content: "Orders table stores paid order facts for GMV analysis.",
        metadata: JSON.stringify({
          assetFamily: "table_description",
          manifestFingerprint: "semantic-assets-two-pass-v1",
          manifestEntryId: "entry-orders-description",
          sourceVersion: "schema-v1",
          tableNames: ["orders"],
          columnNames: [],
          visibilityScope: "datasource",
          preparationStatus: "prepared"
        })
      },
      {
        id: "chunk-two-pass-orders-full-schema",
        datasourceId,
        domain: "semantic_asset",
        content: "Schema: orders(id, amount, status, customer_id)",
        metadata: JSON.stringify({
          assetFamily: "full_schema",
          manifestFingerprint: "semantic-assets-two-pass-v1",
          manifestEntryId: "entry-orders-full-schema",
          sourceVersion: "schema-v1",
          tableNames: ["orders"],
          columnNames: ["id", "amount", "status", "customer_id"],
          visibilityScope: "datasource",
          preparationStatus: "prepared"
        })
      },
      {
        id: "chunk-two-pass-orders-relationship",
        datasourceId,
        domain: "semantic_asset",
        content: "Relationship: orders.customer_id -> customers.id",
        metadata: JSON.stringify({
          assetFamily: "relationship_binding",
          manifestFingerprint: "semantic-assets-two-pass-v1",
          manifestEntryId: "entry-orders-customers-rel",
          sourceVersion: "modeling-v1",
          modelingRevision: 3,
          tableNames: ["orders", "customers"],
          columnNames: ["customer_id", "id"],
          visibilityScope: "datasource",
          preparationStatus: "prepared"
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "semantic-assets-two-pass-v1:mock",
      createdByRunId: "run-rag-retrieval-two-pass-build-v1",
      activatedByRunId: "run-rag-retrieval-two-pass-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "paid orders GMV",
      datasourceId,
      runId: "run-rag-retrieval-two-pass-v1",
      perLaneLimit: 2,
      finalCandidateLimit: 6
    });

    const candidateIds = response.retrieval_bundle.candidates.map((item) => item.chunk_id);
    expect(candidateIds).toEqual(
      expect.arrayContaining([
        "chunk-two-pass-orders-description",
        "chunk-two-pass-orders-full-schema",
        "chunk-two-pass-orders-relationship"
      ])
    );
    expect(response.retrieval_bundle.two_pass_schema_recall).toMatchObject({
      status: "applied",
      selected_table_names: ["orders"],
      table_description_evidence_ids: ["chunk-two-pass-orders-description"],
      supplemental_evidence_ids: expect.arrayContaining([
        "chunk-two-pass-orders-full-schema",
        "chunk-two-pass-orders-relationship"
      ]),
      supplemental_families: expect.arrayContaining(["full_schema", "relationship_binding"])
    });

    const replayEvents = await replayRepository.listByRunId("run-rag-retrieval-two-pass-v1");
    const fusedPayload = JSON.parse(
      replayEvents.find((item) => item.replayKey === "retrieval:fused")?.payload ?? "{}"
    ) as {
      twoPassSchemaRecall?: { status?: string; supplementalFamilies?: string[] };
      candidates?: Array<{ assetFamily?: string; manifestFingerprint?: string }>;
    };
    expect(fusedPayload.twoPassSchemaRecall?.status).toBe("applied");
    expect(fusedPayload.twoPassSchemaRecall?.supplementalFamilies).toEqual(
      expect.arrayContaining(["full_schema", "relationship_binding"])
    );
    expect(fusedPayload.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetFamily: "table_description",
          manifestFingerprint: "semantic-assets-two-pass-v1"
        })
      ])
    );

    await moduleRef.close();
  });

  it("marks trusted prior SQL as ambiguous when multiple high-confidence candidates remain", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);

    const datasourceId = "ds-rag-retrieval-prior-sql-ambiguous";
    const workspaceId = "ws-rag-prior-ambiguous";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-prior-ambiguous-schema",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status)"
      },
      {
        id: "chunk-prior-ambiguous-sql-1",
        datasourceId,
        domain: "sql_example",
        content: "Question: paid orders\\nSQL:\\nSELECT SUM(amount) FROM orders WHERE status = 'paid'",
        metadata: JSON.stringify({
          trusted: true,
          priorSql: true,
          workspaceId,
          tableNames: ["orders"],
          columnNames: ["amount", "status"]
        })
      },
      {
        id: "chunk-prior-ambiguous-sql-2",
        datasourceId,
        domain: "sql_example",
        content: "Question: paid order gmv\\nSQL:\\nSELECT AVG(amount) FROM orders WHERE status = 'paid'",
        metadata: JSON.stringify({
          trusted: true,
          priorSql: true,
          workspaceId,
          tableNames: ["orders"],
          columnNames: ["amount", "status"]
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-prior-sql-ambiguous-v1",
      createdByRunId: "run-rag-retrieval-prior-sql-ambiguous-build-v1",
      activatedByRunId: "run-rag-retrieval-prior-sql-ambiguous-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "orders paid gmv",
      datasourceId,
      workspaceId,
      allowedTables: ["orders"],
      runId: "run-rag-retrieval-prior-sql-ambiguous-v1"
    });

    const priorSqlLane = response.retrieval_bundle.prior_sql_lane;
    expect(priorSqlLane?.status).toBe("ambiguous");
    expect(priorSqlLane?.selected_count).toBe(0);
    expect(priorSqlLane?.eligible_count).toBe(2);
    expect(priorSqlLane?.shortcut?.status).toBe("ambiguous");

    await moduleRef.close();
  });

  it("marks trusted prior SQL as stale when stale flags exist in source metadata", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);

    const datasourceId = "ds-rag-retrieval-prior-sql-stale";
    const workspaceId = "ws-rag-prior-stale";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-prior-stale-schema",
        datasourceId,
        domain: "schema",
        content: "table orders(id, amount, status)"
      },
      {
        id: "chunk-prior-stale-sql-1",
        datasourceId,
        domain: "sql_example",
        content: "Question: paid orders\\nSQL:\\nSELECT SUM(amount) FROM orders WHERE status = 'paid'",
        metadata: JSON.stringify({
          trusted: true,
          priorSql: true,
          stale: true,
          workspaceId,
          tableNames: ["orders"],
          columnNames: ["amount", "status"]
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-prior-sql-stale-v1",
      createdByRunId: "run-rag-retrieval-prior-sql-stale-build-v1",
      activatedByRunId: "run-rag-retrieval-prior-sql-stale-build-v1"
    });

    const response = await retrievalService.retrieve({
      query: "orders paid gmv",
      datasourceId,
      workspaceId,
      allowedTables: ["orders"],
      runId: "run-rag-retrieval-prior-sql-stale-v1"
    });

    const priorSqlLane = response.retrieval_bundle.prior_sql_lane;
    expect(priorSqlLane?.status).toBe("stale");
    expect(priorSqlLane?.selected_count).toBe(0);
    expect(priorSqlLane?.stale_count).toBe(1);
    expect(priorSqlLane?.shortcut?.status).toBe("stale");

    await moduleRef.close();
  });

  it("uses conservative table-first/field-second pruning on wide tables and safely degrades when evidence is weak", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);
    const replayRepository = moduleRef.get(RagReplayRepository);

    const datasourceId = "ds-rag-retrieval-column-pruning";
    const wideColumns = [
      "id",
      "customer_id",
      "amount",
      "status",
      "order_date",
      "shipping_city",
      "sales_region",
      "discount_rate",
      "internal_note",
      "legacy_flag",
      "created_at",
      "updated_at"
    ];
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-wide-schema-orders",
        datasourceId,
        domain: "schema",
        content: `table orders_wide(${wideColumns.join(", ")})`,
        metadata: JSON.stringify({
          chunkProfile: "schema_table",
          tableNames: ["orders_wide"],
          columnNames: wideColumns
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-column-pruning-v1",
      createdByRunId: "run-rag-retrieval-column-pruning-build-v1",
      activatedByRunId: "run-rag-retrieval-column-pruning-build-v1"
    });

    const strongSignal = await retrievalService.retrieve({
      query: "orders_wide amount status",
      datasourceId,
      runId: "run-rag-retrieval-column-pruning-strong-v1"
    });
    const strongColumns =
      strongSignal.retrieval_bundle.candidates.find(
        (candidate) => candidate.chunk_id === "chunk-wide-schema-orders"
      )?.chunk.metadata.columnNames ?? [];
    expect(strongColumns.length).toBeGreaterThan(0);
    expect(strongColumns.length).toBeLessThan(wideColumns.length);
    expect(strongColumns).toEqual(expect.arrayContaining(["amount", "status"]));
    expect(strongColumns).not.toContain("internal_note");

    const uncertainSignal = await retrievalService.retrieve({
      query: "orders_wide customer profile",
      datasourceId,
      runId: "run-rag-retrieval-column-pruning-uncertain-v1"
    });
    const uncertainColumns =
      uncertainSignal.retrieval_bundle.candidates.find(
        (candidate) => candidate.chunk_id === "chunk-wide-schema-orders"
      )?.chunk.metadata.columnNames ?? [];
    expect(uncertainColumns.length).toBeGreaterThan(1);
    expect(uncertainColumns.length).toBeLessThanOrEqual(wideColumns.length);

    const weakSignal = await retrievalService.retrieve({
      query: "orders_wide overview",
      datasourceId,
      runId: "run-rag-retrieval-column-pruning-weak-v1"
    });
    const weakColumns =
      weakSignal.retrieval_bundle.candidates.find(
        (candidate) => candidate.chunk_id === "chunk-wide-schema-orders"
      )?.chunk.metadata.columnNames ?? [];
    expect(weakColumns).toHaveLength(wideColumns.length);

    const replayEvents = await replayRepository.listByRunId(
      "run-rag-retrieval-column-pruning-strong-v1"
    );
    const fusedReplay = replayEvents.find((item) => item.replayKey === "retrieval:fused");
    const fusedPayload = JSON.parse(fusedReplay?.payload ?? "{}") as {
      columnPruning?: {
        status?: string;
        tables?: Array<{
          table_name?: string;
          mode?: string;
        }>;
      };
    };
    expect(fusedPayload.columnPruning?.status).toBe("applied");
    expect(fusedPayload.columnPruning?.tables?.[0]?.table_name).toBe("orders_wide");
    expect(fusedPayload.columnPruning?.tables?.[0]?.mode).toBe("conservative");

    await moduleRef.close();
  });

  it("returns degraded bundle when datasource has no active index", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const retrievalService = moduleRef.get(RagRetrievalService);

    const response = await retrievalService.retrieve({
      query: "orders",
      datasourceId: "ds-rag-retrieval-no-active-index",
      runId: "run-rag-retrieval-no-active-index"
    });

    expect(response.retrieval_bundle.status).toBe("degraded");
    expect(response.retrieval_bundle.degrade_reasons).toEqual(
      expect.arrayContaining(["no_active_index"])
    );
    expect(response.retrieval_bundle.context_pack?.status).toBe("degraded");
    expect(response.retrieval_bundle.candidates).toHaveLength(0);

    await moduleRef.close();
  });

  it("injects active modeling revision into context pack when workspace scope exists", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();
    const indexRepository = moduleRef.get(RagIndexRepository);
    const indexBuilder = moduleRef.get(RagIndexBuilderService);
    const retrievalService = moduleRef.get(RagRetrievalService);
    const modelingGraphRepository = moduleRef.get(ModelingGraphRepository);

    const datasourceId = "ds-rag-retrieval-modeling-revision";
    const workspaceId = "ws-rag-retrieval-modeling-revision";
    indexRepository.seedChunksForDatasource(datasourceId, [
      {
        id: "chunk-schema-revision",
        datasourceId,
        domain: "schema",
        content: "table payments(id, amount)",
        metadata: JSON.stringify({
          tableNames: ["payments"],
          columnNames: ["id", "amount"]
        })
      }
    ]);
    await indexBuilder.buildAndActivate({
      datasourceId,
      sourceVersion: "source-rag-retrieval-modeling-revision-v1",
      createdByRunId: "run-rag-retrieval-modeling-revision-build-v1",
      activatedByRunId: "run-rag-retrieval-modeling-revision-build-v1"
    });

    const revision = await modelingGraphRepository.appendDraftRevision({
      workspaceId,
      datasourceId,
      graphHash: "graph-hash-modeling-revision-v1",
      graphPayload: {
        models: [],
        relationships: [],
        calculatedFields: [],
        views: [],
        schemaChanges: []
      },
      actorId: "system"
    });
    await modelingGraphRepository.markActiveRevision({
      workspaceId,
      datasourceId,
      revision: revision.revision,
      actorId: "system"
    });

    const response = await retrievalService.retrieve({
      query: "payments amount",
      datasourceId,
      workspaceId,
      runId: "run-rag-retrieval-modeling-revision-v1"
    });

    expect(response.retrieval_bundle.context_pack?.modeling_revision).toBe(revision.revision);
    await moduleRef.close();
  });
});
