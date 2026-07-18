import { ResearchCoverageService } from "../../src/modules/knowledge/research/research-coverage.service";
import type {
  ResearchBrief,
  ResearchSourceSnapshotRecord
} from "../../src/modules/knowledge/research/contracts/research.types";

describe("ResearchCoverageService", () => {
  const service = new ResearchCoverageService();

  it("closes coverage only with independent sources and counter evidence", () => {
    const result = service.evaluate({
      brief: brief(),
      snapshots: [snapshot("a", "one.example.com", "primary"), snapshot("b", "two.example.org", "counter_evidence")]
    });

    expect(result.status).toBe("complete");
    expect(result.stopReason).toBe("coverage_closed");
    expect(result.obligations.every((item) => item.status === "passed")).toBe(
      true
    );
  });

  it("returns partial at budget stop instead of simulating completion", () => {
    const result = service.evaluate({
      brief: brief(),
      snapshots: [snapshot("a", "one.example.com", "primary")],
      budgetExhausted: true
    });

    expect(result.status).toBe("partial");
    expect(result.stopReason).toBe("budget_exhausted");
    expect(
      result.obligations.find((item) => item.id === "counter_evidence")?.status
    ).toBe("failed");
  });

  it("preserves conflict state after coverage closes", () => {
    const result = service.evaluate({
      brief: brief(),
      snapshots: [snapshot("a", "one.example.com", "primary"), snapshot("b", "two.example.org", "counter_evidence")],
      conflictCount: 1
    });

    expect(result.status).toBe("conflicted");
  });
});

function brief(): ResearchBrief {
  return {
    version: "research-brief.v1",
    taskId: "task-1",
    revisionId: "revision-1",
    workspaceId: "workspace-1",
    question: "why",
    decisionUse: "decision",
    policyId: "policy-1",
    policyDigest: "policy-digest",
    connectorConfigId: "connector-1",
    connectorConfigDigest: "connector-digest",
    queryBudget: 2,
    resultBudget: 10,
    extractBudget: 10,
    contentByteBudget: 100_000,
    minIndependentSources: 2,
    requireCounterEvidence: true,
    stopConditions: ["coverage_closed"]
  };
}

function snapshot(
  id: string,
  hostname: string,
  queryKind: "primary" | "counter_evidence"
): ResearchSourceSnapshotRecord {
  return {
    id,
    workspaceId: "workspace-1",
    taskId: "task-1",
    revisionId: "revision-1",
    policyId: "policy-1",
    connectorConfigId: "connector-1",
    provider: "tavily",
    canonicalUrl: `https://${hostname}/report`,
    locator: `https://${hostname}/report`,
    mimeType: "text/markdown",
    contentDigest: `digest-${id}`,
    contentSizeBytes: 100,
    completeness: "complete",
    injectionIndicators: [],
    providerMetadata: { queryKind },
    retrievedAt: "2026-07-17T00:00:00.000Z",
    retentionExpiresAt: "2026-08-17T00:00:00.000Z"
  };
}
