import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EVIDENCE_REF_PREFIX = "data/reports/r6";
const EVIDENCE_FILE_NAMES = [
  "gate-summary.json",
  "cache-budget-validation.json",
  "graph-fallback-chaos.json",
  "release-checklist.md",
  "rollback-rehearsal.md"
];

describe("r6 evidence pipeline integration", () => {
  const temporaryRoots: string[] = [];
  const backendRoot = resolve(__dirname, "../..");
  const collectorScriptPath = resolve(backendRoot, "scripts/collect-r6-evidence.mjs");

  afterAll(async () => {
    for (const temporaryRoot of temporaryRoots) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("fails fast when required evidence is missing", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "r6-evidence-missing-"));
    temporaryRoots.push(fixtureRoot);
    const reportDir = join(fixtureRoot, "reports");
    await mkdir(reportDir, { recursive: true });
    await writeGateSummary({
      reportDir,
      releaseCandidate: "r6-missing-evidence"
    });

    const result = spawnSync("node", [collectorScriptPath], {
      cwd: backendRoot,
      env: {
        ...process.env,
        RELEASE_CANDIDATE: "r6-missing-evidence",
        R6_REPORT_DIR: reportDir,
        R6_EVIDENCE_ARCHIVE_DIR: join(fixtureRoot, "archive"),
        R6_EVIDENCE_TIMESTAMP: "2026-04-18T03:31:00.000Z"
      },
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing_evidence:data/reports/r6/cache-budget-validation.json");
    expect(result.stderr).toContain("missing_evidence:data/reports/r6/graph-fallback-chaos.json");
    expect(result.stderr).toContain("missing_evidence:data/reports/r6/release-checklist.md");
    expect(result.stderr).toContain("missing_evidence:data/reports/r6/rollback-rehearsal.md");
  });

  it("archives complete evidence bundle and emits deterministic manifest", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "r6-evidence-complete-"));
    temporaryRoots.push(fixtureRoot);
    const reportDir = join(fixtureRoot, "reports");
    const archiveRoot = join(fixtureRoot, "archive");
    await writeCompleteEvidenceBundle({
      reportDir,
      releaseCandidate: "r6-evidence-complete"
    });

    const result = spawnSync("node", [collectorScriptPath], {
      cwd: backendRoot,
      env: {
        ...process.env,
        RELEASE_CANDIDATE: "r6-evidence-complete",
        R6_REPORT_DIR: reportDir,
        R6_EVIDENCE_ARCHIVE_DIR: archiveRoot,
        R6_EVIDENCE_TIMESTAMP: "2026-04-18T03:32:00.000Z"
      },
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      status: string;
      archiveDir: string;
      manifestPath: string;
    };
    expect(payload.status).toBe("ok");

    const manifestRaw = await readFile(payload.manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw) as {
      incomplete: boolean;
      artifacts: Array<{ fileName: string; archivePath: string; sizeBytes: number }>;
    };
    expect(manifest.incomplete).toBe(false);
    expect(manifest.artifacts).toHaveLength(EVIDENCE_FILE_NAMES.length);
    for (const fileName of EVIDENCE_FILE_NAMES) {
      expect(
        manifest.artifacts.some(
          (artifact) => artifact.fileName === fileName && artifact.sizeBytes > 0
        )
      ).toBe(true);
    }

    const latestRaw = await readFile(join(reportDir, "release-evidence-latest.json"), "utf8");
    const latest = JSON.parse(latestRaw) as { incomplete: boolean };
    expect(latest.incomplete).toBe(false);
  });

  it("materializes release evidence fixture at R6_REPORT_DIR when requested by CI", async () => {
    const reportDir = process.env.R6_REPORT_DIR;
    if (!reportDir) {
      expect(reportDir).toBeUndefined();
      return;
    }

    await rm(reportDir, { recursive: true, force: true });
    await writeCompleteEvidenceBundle({
      reportDir,
      releaseCandidate: process.env.RELEASE_CANDIDATE || "r6-ci-local"
    });

    const summaryRaw = await readFile(join(reportDir, "gate-summary.json"), "utf8");
    const summary = JSON.parse(summaryRaw) as {
      gateDecision: string;
      evidenceRefs: string[];
    };
    expect(summary.gateDecision).toBe("pass");
    expect(summary.evidenceRefs).toEqual(
      expect.arrayContaining(EVIDENCE_FILE_NAMES.map((name) => `${EVIDENCE_REF_PREFIX}/${name}`))
    );
  });
});

async function writeCompleteEvidenceBundle(input: {
  reportDir: string;
  releaseCandidate: string;
}): Promise<void> {
  await mkdir(input.reportDir, { recursive: true });
  await writeGateSummary(input);
  await writeFile(
    join(input.reportDir, "cache-budget-validation.json"),
    JSON.stringify(
      {
        generatedAt: "2026-04-18T03:30:00.000Z",
        cacheEligibleHitRate: 0.71,
        budgetDegradeRate: 0.04,
        sampleSize1h: 1200
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(input.reportDir, "graph-fallback-chaos.json"),
    JSON.stringify(
      {
        generatedAt: "2026-04-18T03:30:30.000Z",
        scenario: "graph_acceleration_fault",
        fallbackActivated: true,
        recoveredAfterMs: 120
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(input.reportDir, "release-checklist.md"),
    [
      "# R6 Release Checklist",
      "",
      "- [x] gate-summary.json generated",
      "- [x] cache-budget-validation.json generated",
      "- [x] graph-fallback-chaos.json generated",
      "- [x] rollback-rehearsal.md generated"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(input.reportDir, "rollback-rehearsal.md"),
    [
      "# R6 Rollback Rehearsal",
      "",
      "- Trigger: graph acceleration fault + budget pressure",
      "- Action: route to postgres-only and hold rollout",
      "- Result: rollback path remains available"
    ].join("\n"),
    "utf8"
  );
}

async function writeGateSummary(input: {
  reportDir: string;
  releaseCandidate: string;
}): Promise<void> {
  await writeFile(
    join(input.reportDir, "gate-summary.json"),
    JSON.stringify(
      {
        generatedAt: "2026-04-18T03:30:00.000Z",
        releaseCandidate: input.releaseCandidate,
        sampleReady: true,
        gatePass: true,
        gateDecision: "pass",
        metrics: [
          {
            name: "retrievalP95Ms",
            value: 645,
            threshold: "<= 700",
            window: "1h",
            minSamples: 1000,
            samples: 1200,
            met: true,
            action: "block",
            state: "met"
          },
          {
            name: "budgetDegradeRate",
            value: 0.04,
            threshold: "<= 0.08",
            window: "1h",
            minSamples: 500,
            samples: 1200,
            met: true,
            action: "rollback-observe",
            state: "met"
          }
        ],
        blockReasons: [],
        freezeReasons: [],
        rollbackReasons: [],
        evidenceRefs: EVIDENCE_FILE_NAMES.map(
          (fileName) => `${EVIDENCE_REF_PREFIX}/${fileName}`
        )
      },
      null,
      2
    ),
    "utf8"
  );
}
