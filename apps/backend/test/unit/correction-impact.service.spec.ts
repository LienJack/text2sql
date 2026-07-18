import { CorrectionImpactService } from "../../src/modules/conversation/analysis/correction/correction-impact.service";

describe("CorrectionImpactService", () => {
  it("walks downstream lineage, invalidates targets and holds governed assets", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      analysisArtifact: {
        findMany: jest.fn().mockResolvedValue([
          { id: "metric", artifactType: "analysis.metric_definition" },
          { id: "sql", artifactType: "analysis.sql_evidence" },
          { id: "claim", artifactType: "analysis.claim" },
          { id: "unrelated", artifactType: "analysis.report" }
        ]),
        updateMany
      },
      analysisArtifactLink: {
        findMany: jest.fn().mockResolvedValue([
          { sourceArtifactId: "sql", targetArtifactId: "metric" },
          { sourceArtifactId: "claim", targetArtifactId: "sql" }
        ])
      },
      analysisManifest: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn()
      }
    };
    const ledger = {
      transaction: jest.fn((operation: (value: unknown) => unknown) =>
        operation(transaction)
      )
    };
    const tasks = { appendEvent: jest.fn().mockResolvedValue(undefined) };
    const assets = {
      holdImpactedBySources: jest.fn().mockResolvedValue(["skill-1"])
    };
    const service = new CorrectionImpactService(
      ledger as never,
      tasks as never,
      assets as never
    );

    const result = await service.apply({
      taskId: "task-1",
      revisionId: "revision-1",
      workspaceId: "workspace-1",
      correctionRef: "correction-1",
      targetArtifactRefs: ["metric"],
      actorId: "analyst-1",
      computedAt: "2026-07-17T00:00:00.000Z"
    });

    expect(result.invalidatedArtifactRefs).toEqual(["metric"]);
    expect(result.staleArtifactRefs).toEqual(["claim", "sql"]);
    expect(result.impactedArtifactRefs).not.toContain("unrelated");
    expect(result.impactedKnowledgeAssetRefs).toEqual(["skill-1"]);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(assets.holdImpactedBySources).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRefs: ["claim", "metric", "sql"]
      })
    );
  });
});
