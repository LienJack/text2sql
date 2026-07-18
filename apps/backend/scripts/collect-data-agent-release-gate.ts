import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DataAgentEvaluationService,
  type DataAgentEvidenceComponent,
  type DataAgentReleaseManifest
} from "../src/modules/conversation/analysis/evaluation/data-agent-evaluation.service";
import type { Text2SqlAccuracyReleasePhase } from "../src/modules/conversation/runtime/evaluation/text2sql-accuracy-evaluation.service";
import {
  collectText2SqlAccuracyGate,
  type Text2SqlAccuracyGateReport
} from "./collect-text2sql-accuracy-gate";

export interface CollectDataAgentReleaseGateOptions {
  releaseCandidate: string;
  releasePhase: Text2SqlAccuracyReleasePhase;
  scopeDigest: string;
  text2sqlAccuracy: Text2SqlAccuracyGateReport;
  components?: DataAgentEvidenceComponent[];
  evaluatedAt?: string;
}

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function syntheticComponents(input: {
  releaseCandidate: string;
  scopeDigest: string;
  evaluatedAt: string;
}): DataAgentEvidenceComponent[] {
  const freshUntil = new Date(Date.parse(input.evaluatedAt) + 24 * 60 * 60 * 1_000).toISOString();
  const approval = {
    ownerId: "repository-contract-owner",
    approvedAt: input.evaluatedAt,
    approvalDigest: digest(`repository-contract:${input.releaseCandidate}`)
  };
  const component = (
    id: DataAgentEvidenceComponent["id"],
    evidenceRefs: string[],
    metrics?: DataAgentEvidenceComponent["metrics"]
  ): DataAgentEvidenceComponent => ({
    id,
    version: input.releaseCandidate,
    scopeDigest: input.scopeDigest,
    status: "passed",
    evidenceClass: "synthetic",
    observedAt: input.evaluatedAt,
    freshUntil,
    evidenceRefs,
    ownerApproval: approval,
    metrics
  });
  return [
    component("identity_authorization", ["test:principal-context-policy"]),
    component("durability_recovery", ["test:analysis-durable-runtime"]),
    component("deep_search_coverage", ["test:research-source-snapshot"]),
    component("evidence_claim_integrity", ["test:analysis-evidence-claim-report"]),
    component("knowledge_asset_governance", ["test:knowledge-asset-promotion"]),
    component("multi_worker_paired_eval", ["test:analysis-orchestrator-flow"], {
      pairedNetBenefit: 0
    }),
    component("cost_safety", ["test:bounded-execution"], {
      safetyInvariantFailures: 0
    })
  ];
}

export function collectDataAgentReleaseGate(
  options: CollectDataAgentReleaseGateOptions
): DataAgentReleaseManifest {
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  const provided = new Map(
    (options.components ?? []).map((component) => [component.id, component])
  );
  const components = new Map(
    syntheticComponents({
      releaseCandidate: options.releaseCandidate,
      scopeDigest: options.scopeDigest,
      evaluatedAt
    }).map((component) => [component.id, component])
  );
  for (const [id, component] of provided) components.set(id, component);

  const accuracyStatus =
    options.text2sqlAccuracy.rollout.releaseDecision === "GO"
      ? "passed"
      : options.text2sqlAccuracy.rollout.releaseDecision === "HOLD"
        ? "unknown"
        : "failed";
  const suppliedAccuracy = provided.get("text2sql_outcome");
  components.set("text2sql_outcome", {
    id: "text2sql_outcome",
    version: options.text2sqlAccuracy.version,
    scopeDigest: options.scopeDigest,
    status: accuracyStatus,
    evidenceClass:
      options.text2sqlAccuracy.evidence.signedRealTrialCount > 0
        ? "signed_real"
        : "synthetic",
    observedAt: options.text2sqlAccuracy.generatedAt,
    freshUntil:
      suppliedAccuracy?.freshUntil ??
      new Date(Date.parse(options.text2sqlAccuracy.generatedAt) + 24 * 60 * 60 * 1_000).toISOString(),
    evidenceRefs: [
      `text2sql-accuracy:${options.text2sqlAccuracy.evaluationIdentity}`
    ],
    ownerApproval: suppliedAccuracy?.ownerApproval
  });

  return new DataAgentEvaluationService().evaluate({
    releaseCandidate: options.releaseCandidate,
    releasePhase: options.releasePhase,
    scopeDigest: options.scopeDigest,
    components: Array.from(components.values()),
    evaluatedAt
  });
}

function optionValue(argv: string[], name: string): string | undefined {
  return argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function readComponents(path: string | undefined): Promise<DataAgentEvidenceComponent[]> {
  if (!path || !existsSync(path)) return [];
  const parsed = JSON.parse(await readFile(path, "utf8")) as {
    components?: DataAgentEvidenceComponent[];
  } | DataAgentEvidenceComponent[];
  return Array.isArray(parsed) ? parsed : (parsed.components ?? []);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const releasePhase = (optionValue(argv, "--release-phase") ??
    "pre_release") as Text2SqlAccuracyReleasePhase;
  const fixtureRoot = resolve(__dirname, "../test/fixtures/text2sql-accuracy");
  const accuracy = await collectText2SqlAccuracyGate({
    guidelineBaselinePath:
      optionValue(argv, "--guideline-baseline") ??
      resolve(fixtureRoot, "guideline-baseline.json"),
    slicePath:
      optionValue(argv, "--slice") ??
      resolve(fixtureRoot, "sanitized-reference-slice.json"),
    thresholdsPath:
      optionValue(argv, "--thresholds") ?? resolve(fixtureRoot, "thresholds.json"),
    releasePhase
  });
  const releaseCandidate =
    optionValue(argv, "--release-candidate") ??
    process.env.RELEASE_CANDIDATE ??
    "working-tree";
  const scopeDigest =
    optionValue(argv, "--scope-digest") ?? digest("data-agent:autonomous-analysis:v1");
  const components = await readComponents(
    optionValue(argv, "--evidence-file") ?? process.env.DATA_AGENT_EVIDENCE_FILE
  );
  const report = collectDataAgentReleaseGate({
    releaseCandidate,
    releasePhase,
    scopeDigest,
    text2sqlAccuracy: accuracy,
    components
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if ((argv.includes("--strict") || argv.includes("--fail-on-gate")) && !report.rollout.gatePass) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
