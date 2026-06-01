import { RagDocumentFactory } from "../../src/modules/rag/ingestion/rag-document.factory";
import { SemanticAssetFamilyChunkMapper } from "../../src/modules/knowledge/rag/preparation/semantic-asset-family-chunk.mapper";
import { SemanticAssetManifestBuilder } from "../../src/modules/knowledge/rag/preparation/semantic-asset-manifest.builder";
import { SemanticAssetPreparerService } from "../../src/modules/knowledge/rag/preparation/semantic-asset-preparer.service";
import { SEMANTIC_ASSET_REASON_CODES } from "../../src/modules/knowledge/rag/preparation/semantic-asset-reason-codes";

const embeddingProfile = {
  provider: "mock",
  model: "mock-embedding",
  dimensions: 8,
  vectorVersion: "v1",
  configSource: "settings" as const
};

describe("SemanticAssetPreparerService", () => {
  const preparer = new SemanticAssetPreparerService(
    new SemanticAssetManifestBuilder(),
    new SemanticAssetFamilyChunkMapper()
  );

  it("prepares typed families into manifest entries and ingestion sources", () => {
    const result = preparer.prepare({
      datasourceId: "ds-main",
      workspaceId: "ws-main",
      embeddingProfile,
      sourceSnapshots: [
        {
          family: "table_description",
          sourceKind: "datasource_schema",
          sourceRef: { type: "datasource_schema", ref: "orders.description" },
          sourceVersion: "schema-v1",
          sourceHash: "hash-table-description",
          tableName: "orders",
          title: "Orders table",
          summary: { description: "Paid order facts" }
        },
        {
          family: "full_schema",
          sourceKind: "datasource_schema",
          sourceRef: { type: "datasource_schema", ref: "orders.full_schema" },
          sourceVersion: "schema-v1",
          sourceHash: "hash-full-schema",
          tableName: "orders",
          columns: [
            { name: "id", type: "uuid" },
            { name: "amount", type: "decimal", description: "Order amount" }
          ]
        },
        {
          family: "column_batch",
          sourceKind: "datasource_schema",
          sourceRef: { type: "datasource_schema", ref: "orders.columns" },
          sourceVersion: "schema-v1",
          sourceHash: "hash-column-batch",
          tableName: "orders",
          columns: [{ name: "status", type: "text" }]
        },
        {
          sourceKind: "glossary_term",
          sourceRef: { type: "glossary_term", ref: "gmv" },
          sourceVersion: "glossary-v1",
          sourceHash: "hash-business-term",
          term: "GMV",
          definition: "Gross merchandise value",
          synonyms: ["sales"],
          tableNames: ["orders"],
          columnNames: ["amount"]
        },
        {
          sourceKind: "saved_prior_sql",
          sourceRef: { type: "saved_prior_sql", ref: "prior-1" },
          sourceVersion: "prior-v1",
          sourceHash: "hash-prior-sql",
          question: "paid GMV",
          sql: "SELECT SUM(amount) FROM orders WHERE status = 'paid'",
          trusted: true,
          verified: true,
          viewStatus: "active",
          tableNames: ["orders"],
          columnNames: ["amount", "status"]
        },
        {
          family: "project_metadata",
          sourceKind: "project_metadata",
          sourceRef: { type: "project_metadata", ref: "workspace" },
          sourceVersion: "project-v1",
          sourceHash: "hash-project",
          projectName: "Commerce"
        }
      ]
    });

    expect(result.manifestSummary.entryCount).toBe(6);
    expect(result.manifestSummary.preparedEntryCount).toBe(6);
    expect(result.manifestSummary.familyCounts).toEqual(
      expect.objectContaining({
        table_description: 1,
        full_schema: 1,
        column_batch: 1,
        business_term: 1,
        prior_question_sql: 1,
        project_metadata: 1
      })
    );
    expect(result.ingestionSources).toHaveLength(6);
    expect(result.ingestionSources.map((source) => source.sourceType)).toEqual(
      expect.arrayContaining(["semantic_asset", "semantic_term", "sql_example"])
    );

    const documentFactory = new RagDocumentFactory();
    const documentBuilds = result.ingestionSources.map((source) =>
      documentFactory.create(source)
    );
    const metadata = documentBuilds.map((build) =>
      JSON.parse(build.chunks[0]?.metadata ?? "{}")
    );
    expect(metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetFamily: "table_description",
          manifestFingerprint: result.manifest.fingerprint,
          visibilityScope: "datasource"
        }),
        expect.objectContaining({
          assetFamily: "prior_question_sql",
          trusted: true,
          verified: true,
          viewStatus: "active"
        })
      ])
    );
  });

  it("degrades only modeling relationship assets when payload or revision is missing", () => {
    const result = preparer.prepare({
      datasourceId: "ds-main",
      workspaceId: "ws-main",
      embeddingProfile,
      sourceSnapshots: [
        {
          family: "relationship_binding",
          sourceKind: "modeling_graph",
          sourceRef: { type: "modeling_graph", ref: "relationships" },
          sourceVersion: "modeling-v1",
          sourceHash: "hash-relationships"
        },
        {
          family: "metric",
          sourceKind: "modeling_graph",
          sourceRef: { type: "modeling_graph", ref: "metric.gmv" },
          sourceVersion: "modeling-v1",
          sourceHash: "hash-metric",
          modelingRevision: 7,
          title: "GMV",
          summary: { expression: "SUM(orders.amount)" }
        }
      ]
    });

    const relationship = result.manifest.entries.find(
      (entry) => entry.family === "relationship_binding"
    );
    const metric = result.manifest.entries.find((entry) => entry.family === "metric");

    expect(relationship?.status).toBe("degraded");
    expect(relationship?.reasonCodes).toEqual(
      expect.arrayContaining([
        SEMANTIC_ASSET_REASON_CODES.degradedMissingRelationshipPayload,
        SEMANTIC_ASSET_REASON_CODES.degradedMissingModelingRevision
      ])
    );
    expect(metric?.status).toBe("prepared");
    expect(result.ingestionSources).toHaveLength(1);
  });

  it("excludes non-promoted correction feedback from durable manifest entries", () => {
    const result = preparer.prepare({
      datasourceId: "ds-main",
      workspaceId: "ws-main",
      embeddingProfile,
      sourceSnapshots: [
        {
          sourceKind: "correction_feedback",
          sourceRef: { type: "correction_feedback", ref: "run-1" },
          sourceVersion: "run-1",
          sourceHash: "hash-correction",
          question: "fix SQL",
          sql: "SELECT 1",
          promoted: false
        }
      ]
    });

    expect(result.manifest.entries).toHaveLength(0);
    expect(result.ingestionSources).toHaveLength(0);
    expect(result.excludedSnapshots).toHaveLength(1);
    expect(result.excludedSnapshots[0]?.reasonCodes).toContain(
      SEMANTIC_ASSET_REASON_CODES.skippedCorrectionNotPromoted
    );
  });
});
