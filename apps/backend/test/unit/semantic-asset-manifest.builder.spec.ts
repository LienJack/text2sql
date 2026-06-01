import { SemanticAssetManifestBuilder } from "../../src/modules/knowledge/rag/preparation/semantic-asset-manifest.builder";
import { SEMANTIC_ASSET_REASON_CODES } from "../../src/modules/knowledge/rag/preparation/semantic-asset-reason-codes";

const embeddingProfile = {
  provider: "volcengine",
  model: "embedding-v2",
  dimensions: 1024,
  vectorVersion: "v3",
  configSource: "settings" as const
};

describe("semantic asset manifest builder", () => {
  const builder = new SemanticAssetManifestBuilder();

  it("builds deterministic manifest entries from semantic asset triggers", () => {
    const first = builder.build({
      datasourceId: "sqlite_main",
      workspaceId: "ws-semantic-assets",
      triggers: ["schema", "modeling_revision", "embedding_model"],
      embeddingProfile,
      modelingRevision: 7,
      reasonCodes: ["semantic_asset_reindex_requested"]
    });
    const second = builder.build({
      datasourceId: "sqlite_main",
      workspaceId: "ws-semantic-assets",
      triggers: ["embedding_model", "schema", "modeling_revision"],
      embeddingProfile,
      modelingRevision: 7,
      reasonCodes: ["semantic_asset_reindex_requested"]
    });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toContain("semantic-assets-");
    expect(first.embeddingProfile).toEqual(embeddingProfile);
    expect(first.entries).toHaveLength(3);
    expect(first.familyCounts).toMatchObject({
      full_schema: 1,
      relationship_binding: 1,
      project_metadata: 1
    });
    expect(first.entries.every((entry) => entry.status === "prepared")).toBe(true);
    expect(first.reasonCodes).toEqual(
      expect.arrayContaining([SEMANTIC_ASSET_REASON_CODES.prepared, "trigger:schema"])
    );
  });

  it("returns a skipped manifest summary when no triggers are present", () => {
    const manifest = builder.build({
      datasourceId: "sqlite_main",
      workspaceId: "ws-semantic-assets",
      triggers: [],
      embeddingProfile
    });
    const summary = builder.summarize(manifest);

    expect(summary.entryCount).toBe(0);
    expect(summary.reasonCodes).toContain(SEMANTIC_ASSET_REASON_CODES.skippedNoTriggers);
    expect(summary.familyCounts).toEqual({});
  });

  it("degrades only the affected entry when a provided source snapshot lacks a hash", () => {
    const manifest = builder.build({
      datasourceId: "sqlite_main",
      workspaceId: "ws-semantic-assets",
      triggers: ["schema", "instructions"],
      embeddingProfile,
      sourceSnapshots: {
        schema: {
          family: "full_schema",
          sourceRef: { type: "datasource_schema", ref: "active-schema" },
          sourceVersion: "schema-v1",
          sourceHash: "schema-hash",
          summary: { tableCount: 1 }
        },
        instructions: {
          family: "prompt_instruction",
          sourceRef: { type: "prompt_instruction", ref: "runtime-eligible" },
          sourceVersion: "prompt-v1",
          summary: { scene: "text2sql" }
        }
      }
    });

    const schemaEntry = manifest.entries.find((entry) => entry.family === "full_schema");
    const promptEntry = manifest.entries.find(
      (entry) => entry.family === "prompt_instruction"
    );

    expect(schemaEntry?.status).toBe("prepared");
    expect(promptEntry?.status).toBe("degraded");
    expect(promptEntry?.reasonCodes).toContain(
      SEMANTIC_ASSET_REASON_CODES.degradedMissingSourceHash
    );
    expect(builder.summarize(manifest).degradedEntryCount).toBe(1);
  });
});
