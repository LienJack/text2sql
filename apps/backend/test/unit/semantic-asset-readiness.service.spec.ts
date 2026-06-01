import type { RagIndexVersionRecord } from "../../src/modules/rag/index/rag-index.repository";
import type { SemanticAssetManifestSummary } from "../../src/modules/knowledge/rag/preparation/semantic-asset-manifest.types";
import { SemanticAssetReadinessService } from "../../src/modules/knowledge/rag/preparation/semantic-asset-readiness.service";

function buildManifestSummary(
  overrides: Partial<SemanticAssetManifestSummary> = {}
): SemanticAssetManifestSummary {
  return {
    manifestVersion: "semantic-asset-manifest/v1",
    fingerprint: "fingerprint-a",
    datasourceId: "ds-main",
    workspaceId: "ws-main",
    embeddingProfile: {
      provider: "mock",
      model: "mock-embedding",
      dimensions: 8,
      vectorVersion: "v1",
      configSource: "settings"
    },
    sourceSnapshotSummary: {
      triggers: ["schema"],
      sourceVersion: "snapshot-v1"
    },
    familyCounts: {
      table_description: 1
    },
    reasonCodes: [],
    entryCount: 1,
    preparedEntryCount: 1,
    skippedEntryCount: 0,
    degradedEntryCount: 0,
    ...overrides
  };
}

function buildActiveVersion(
  datasourceId: string,
  sourceVersion: string
): RagIndexVersionRecord {
  return {
    id: `idx-${datasourceId}`,
    datasourceId,
    status: "active",
    sourceVersion,
    activatedAt: "2026-04-30T00:00:00.000Z",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z"
  };
}

describe("SemanticAssetReadinessService", () => {
  it("returns empty missing_active summary when no datasource context exists", async () => {
    const getActiveVersion = jest.fn().mockResolvedValue(undefined);
    const service = new SemanticAssetReadinessService({
      getActiveVersion
    } as never);

    const summary = await service.snapshot();

    expect(summary.status).toBe("missing_active");
    expect(summary.rebuildable).toBe(false);
    expect(summary.familyCounts).toEqual({});
    expect(getActiveVersion).not.toHaveBeenCalled();
  });

  it("marks readiness degraded and appends active_index_changed when active source drifts", async () => {
    const activeVersions: Record<string, RagIndexVersionRecord | undefined> = {
      "ds-main": buildActiveVersion("ds-main", "fingerprint-b:source-v2")
    };
    const getActiveVersion = jest
      .fn()
      .mockImplementation(async (datasourceId: string) => activeVersions[datasourceId]);
    const service = new SemanticAssetReadinessService({
      getActiveVersion
    } as never);

    const activation = service.recordActivation({
      datasourceId: " ds-main ",
      workspaceId: "ws-main",
      runId: "run-1",
      sourceVersion: "fingerprint-a:source-v1",
      indexVersionId: "idx-old",
      manifestSummary: buildManifestSummary({
        reasonCodes: ["degraded_missing_source_hash"],
        degradedEntryCount: 1
      }),
      staleReasons: ["manual_flag", "manual_flag", " "]
    });
    expect(activation.status).toBe("degraded");
    expect(activation.degradedFamilies).toContain("table_description");

    const snapshot = await service.snapshot();

    expect(snapshot.datasourceId).toBe("ds-main");
    expect(snapshot.activeIndexVersionId).toBe("idx-ds-main");
    expect(snapshot.activeSourceVersion).toBe("fingerprint-b:source-v2");
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.staleReasons).toEqual(["active_index_changed", "manual_flag"]);
    expect(snapshot.rebuildable).toBe(true);
  });

  it("returns missing_active with no_active_index when activation exists but no active version", async () => {
    const getActiveVersion = jest.fn().mockResolvedValue(undefined);
    const service = new SemanticAssetReadinessService({
      getActiveVersion
    } as never);

    service.recordActivation({
      datasourceId: "ds-no-active",
      sourceVersion: "fingerprint-c:source-v1",
      indexVersionId: "idx-c",
      manifestSummary: buildManifestSummary({
        datasourceId: "ds-no-active"
      })
    });

    const snapshot = await service.snapshot({ datasourceId: "ds-no-active" });

    expect(snapshot.status).toBe("missing_active");
    expect(snapshot.staleReasons).toContain("no_active_index");
    expect(snapshot.rebuildable).toBe(true);
  });

  it("builds ready snapshot from active version even before any activation record exists", async () => {
    const activeVersions: Record<string, RagIndexVersionRecord | undefined> = {
      "ds-fresh": buildActiveVersion("ds-fresh", "fingerprint-fresh:source-v1")
    };
    const getActiveVersion = jest
      .fn()
      .mockImplementation(async (datasourceId: string) => activeVersions[datasourceId]);
    const service = new SemanticAssetReadinessService({
      getActiveVersion
    } as never);

    const snapshot = await service.snapshot({ datasourceId: "ds-fresh" });

    expect(snapshot.status).toBe("ready");
    expect(snapshot.datasourceId).toBe("ds-fresh");
    expect(snapshot.activeIndexVersionId).toBe("idx-ds-fresh");
    expect(snapshot.activeManifestFingerprint).toBe("fingerprint-fresh");
    expect(snapshot.lastActivation?.indexVersionId).toBe("idx-ds-fresh");
  });
});
