import {
  createResearchTestHarness,
  type ResearchTestHarness
} from "../support/research-test-harness";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("ResearchSourceSnapshotService", () => {
  let harness: ResearchTestHarness;

  beforeEach(async () => {
    harness = await createResearchTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("freezes an authorized, normalized and digest-bound source snapshot", async () => {
    const snapshot = await harness.snapshots.freeze({
      policy: harness.policy,
      taskId: harness.taskId,
      revisionId: harness.revisionId,
      source: {
        url: "https://one.example.com/report?utm_source=search&lang=zh#summary",
        title: "Revenue report",
        content: "Revenue declined by 12%.\r\nChannel mix changed.",
        mimeType: "text/markdown"
      },
      providerRequestId: "extract-request-1",
      queryKind: "primary",
      publishedAt: "2026-07-01T00:00:00.000Z",
      relevanceScore: 0.99,
      contentByteBudget: 16 * 1024
    });

    expect(snapshot.canonicalUrl).toBe(
      "https://one.example.com/report?lang=zh"
    );
    expect(snapshot.completeness).toBe("complete");
    expect(snapshot.providerMetadata.relevanceScoreIsTruthEvidence).toBe(false);
    expect(snapshot.retentionExpiresAt).toBeTruthy();
    expect(await harness.snapshots.readSnapshotContent(snapshot.id)).toBe(
      "Revenue declined by 12%.\nChannel mix changed."
    );

    const repeated = await harness.snapshots.freeze({
      policy: harness.policy,
      taskId: harness.taskId,
      revisionId: harness.revisionId,
      source: {
        url: "https://one.example.com/report?lang=zh",
        title: "Revenue report",
        content: "Revenue declined by 12%.\nChannel mix changed.",
        mimeType: "text/markdown"
      },
      providerRequestId: "extract-request-2",
      queryKind: "primary",
      contentByteBudget: 16 * 1024
    });
    expect(repeated.id).toBe(snapshot.id);
    expect(repeated.contentDigest).toBe(snapshot.contentDigest);
  });

  it("marks bounded truncation partial instead of claiming complete", async () => {
    const snapshot = await harness.snapshots.freeze({
      policy: harness.policy,
      taskId: harness.taskId,
      revisionId: harness.revisionId,
      source: {
        url: "https://two.example.org/large",
        content: "数据".repeat(100),
        mimeType: "text/markdown"
      },
      providerRequestId: "extract-large",
      queryKind: "counter_evidence",
      contentByteBudget: 24
    });

    expect(snapshot.completeness).toBe("partial");
    expect(snapshot.contentSizeBytes).toBeLessThanOrEqual(24);
    expect(snapshot.providerMetadata.extractionTruncated).toBe(true);
  });
});
