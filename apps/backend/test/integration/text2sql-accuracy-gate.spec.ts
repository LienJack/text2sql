import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  collectText2SqlAccuracyGate,
  compareGuidelineBaseline,
  type GuidelineBaseline
} from "../../scripts/collect-text2sql-accuracy-gate";

describe("text2sql accuracy gate integration", () => {
  const fixtureRoot = resolve(__dirname, "../fixtures/text2sql-accuracy");

  it("executes the sanitized SQL pair and keeps release on HOLD without real Outcome evidence", async () => {
    const options = {
      guidelineBaselinePath: resolve(fixtureRoot, "guideline-baseline.json"),
      slicePath: resolve(fixtureRoot, "sanitized-reference-slice.json"),
      thresholdsPath: resolve(fixtureRoot, "thresholds.json"),
      releasePhase: "pre_release" as const,
      guidelineSourceRoot: resolve(fixtureRoot, "missing-upstream"),
      closeoutReport: {
        rollout: {
          gatePass: true,
          recommendedStage: "direct_v2_go",
          rollbackSuggested: false,
          reasons: []
        }
      } as never
    };
    const first = await collectText2SqlAccuracyGate(options);
    const second = await collectText2SqlAccuracyGate(options);

    expect(first.evidence.sanitizedTrialCount).toBe(4);
    expect(first.summary.baselineOutcomeAccuracy).toBe(1);
    expect(first.summary.candidateOutcomeAccuracy).toBe(0.5);
    expect(first.summary.realOutcomePairCount).toBe(0);
    expect(first.closeout.status).toBe("passed");
    expect(first.rollout.releaseDecision).toBe("HOLD");
    expect(first.rollout.reasons).toContain("real_outcome_evidence_missing");
    expect(first.evaluationIdentity).toBe(second.evaluationIdentity);

    const publicReport = JSON.stringify(first);
    expect(publicReport).not.toContain("CREATE TABLE");
    expect(publicReport).not.toContain("expectedRows");
    expect(publicReport).not.toContain("rootPath");
  });

  it("maps guideline digest drift to the affected gate requirements", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "text2sql-guideline-"));
    const original = "frozen guideline";
    await writeFile(join(sourceRoot, "guideline.md"), original);
    const baseline: GuidelineBaseline = {
      version: "text2sql-guideline-baseline/v1",
      baselineId: "test-baseline",
      source: {
        projectSlug: "test",
        projectStatus: "exploring",
        projectUpdatedAt: "2026-07-17T00:00:00.000Z",
        rootPath: sourceRoot
      },
      artifacts: [
        {
          id: "RQ014",
          relativePath: "guideline.md",
          sha256: createHash("sha256").update(original).digest("hex"),
          capturedAt: "2026-07-17T00:00:00.000Z",
          appliesToRequirements: ["R9", "R12"]
        }
      ]
    };

    expect((await compareGuidelineBaseline(baseline)).sourceStatus).toBe("current");
    await writeFile(join(sourceRoot, "guideline.md"), "changed guideline");
    expect(await compareGuidelineBaseline(baseline)).toMatchObject({
      sourceStatus: "drifted",
      driftedArtifactIds: ["RQ014"],
      affectedRequirements: ["R12", "R9"]
    });
  });
});
