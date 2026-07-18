import { RagCacheKeyFactory } from "../../src/modules/rag/perf/rag-cache-key.factory";

describe("RagCacheKeyFactory", () => {
  it.each([
    ["policyVersion", { policyVersion: 2 }],
    ["policyDigest", { policyDigest: "policy-2" }],
    ["schemaSnapshotDigest", { schemaSnapshotDigest: "schema-2" }],
    ["allowedColumnsDigest", { allowedColumnsDigest: "columns-2" }],
    ["semanticVersion", { semanticVersion: 2 }],
    ["modelingRevision", { modelingRevision: 2 }],
    ["valueSketchVersion", { valueSketchVersion: "values-2" }],
    ["priorSqlVersion", { priorSqlVersion: "prior-2" }],
    ["promptVersion", { promptVersion: "prompt-2" }]
  ] as const)("invalidates the cache identity when %s changes", (_field, delta) => {
    const factory = new RagCacheKeyFactory();
    const baseline = {
      stage: "retrieval_bundle" as const,
      datasourceId: "ds-1",
      indexVersionId: "idx-1",
      query: "orders amount",
      workspaceId: "ws-1",
      allowedTables: ["orders"],
      policyVersion: 1,
      policyDigest: "policy-1",
      schemaSnapshotDigest: "schema-1",
      allowedColumnsDigest: "columns-1",
      semanticVersion: 1,
      modelingRevision: 1,
      valueSketchVersion: "values-1",
      priorSqlVersion: "prior-1",
      promptVersion: "prompt-1"
    };

    expect(factory.build({ ...baseline, ...delta })).not.toBe(factory.build(baseline));
  });
});
