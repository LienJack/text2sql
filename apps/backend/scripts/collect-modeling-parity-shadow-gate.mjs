#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RELATIONSHIP_SCRIPT = resolve(
  SCRIPT_DIR,
  "./collect-relationship-platform-shadow-gate.mjs"
);
const SEMANTIC_SPINE_SCRIPT = resolve(
  SCRIPT_DIR,
  "./collect-semantic-spine-shadow-gate.mjs"
);

const DEFAULT_REL_INPUT = resolve(
  process.cwd(),
  "data/reports/relationship-platform-shadow/samples.json"
);
const DEFAULT_REL_OUTPUT = resolve(
  process.cwd(),
  "data/reports/relationship-platform-shadow/gate-summary.json"
);
const DEFAULT_SPINE_INPUT = resolve(
  process.cwd(),
  "data/reports/semantic-spine-shadow/samples.json"
);
const DEFAULT_SPINE_OUTPUT = resolve(
  process.cwd(),
  "data/reports/semantic-spine-shadow/gate-summary.json"
);
const DEFAULT_OUTPUT = resolve(
  process.cwd(),
  "data/reports/modeling-parity-shadow/gate-summary.json"
);
const DEFAULT_MODELING_INPUT = resolve(
  process.cwd(),
  "data/reports/modeling-parity-shadow/samples.json"
);

async function readJson(filePath, fallback = {}) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function runScript(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status === 0) {
    return;
  }
  const reason = result.stderr?.trim() || result.stdout?.trim() || "unknown error";
  throw new Error(`Failed to execute ${scriptPath}: ${reason}`);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeReasons(prefix, reasons) {
  if (!Array.isArray(reasons)) {
    return [];
  }
  return reasons
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .map((item) => `${prefix}:${item}`);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function clampRatio(value) {
  return Math.min(1, Math.max(0, toNumber(value, 0)));
}

function avg(values) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function metricCoverage(samples, fieldName) {
  if (samples.length === 0) {
    return 0;
  }
  const validCount = samples.filter((item) => Number.isFinite(Number(item?.[fieldName]))).length;
  return Number((validCount / samples.length).toFixed(6));
}

function readModelingThresholds() {
  return {
    minSamples: toNumber(process.env.MODELING_PARITY_MIN_SAMPLES, 30),
    maxDeployBlockRate: toNumber(process.env.MODELING_PARITY_MAX_DEPLOY_BLOCK_RATE, 0.4),
    maxRollbackRate: toNumber(process.env.MODELING_PARITY_MAX_ROLLBACK_RATE, 0.15),
    maxSchemaBacklogAvg: toNumber(process.env.MODELING_PARITY_MAX_SCHEMA_BACKLOG_AVG, 2),
    minSaveAsViewSuccessRate: toNumber(
      process.env.MODELING_PARITY_MIN_SAVE_AS_VIEW_SUCCESS_RATE,
      0.8
    ),
    maxRuntimeRevisionMissingRate: toNumber(
      process.env.MODELING_PARITY_MAX_RUNTIME_REVISION_MISSING_RATE,
      0.1
    ),
    minSignalCoverageRate: toNumber(process.env.MODELING_PARITY_MIN_SIGNAL_COVERAGE_RATE, 0.7)
  };
}

function evaluateModelingWorkspace(samples, thresholds) {
  const sampleSize = samples.length;
  const sampleReady = sampleSize >= thresholds.minSamples;
  const deployBlockRate = avg(samples.map((item) => clampRatio(item.deployBlockRate)));
  const rollbackRate = avg(samples.map((item) => clampRatio(item.rollbackRate)));
  const schemaBacklogAvg = avg(samples.map((item) => Math.max(0, toNumber(item.schemaBacklog))));
  const saveAsViewSuccessRate = avg(
    samples.map((item) => clampRatio(item.saveAsViewSuccessRate))
  );
  const runtimeRevisionMissingRate = avg(
    samples.map((item) => clampRatio(item.runtimeRevisionMissingRate))
  );
  const signalCoverage = {
    deployBlockRate: metricCoverage(samples, "deployBlockRate"),
    rollbackRate: metricCoverage(samples, "rollbackRate"),
    schemaBacklog: metricCoverage(samples, "schemaBacklog"),
    saveAsViewSuccessRate: metricCoverage(samples, "saveAsViewSuccessRate"),
    runtimeRevisionMissingRate: metricCoverage(samples, "runtimeRevisionMissingRate")
  };

  const reasons = [];
  if (!sampleReady) {
    reasons.push("sample_not_ready");
  }
  if (
    sampleReady &&
    signalCoverage.deployBlockRate < thresholds.minSignalCoverageRate
  ) {
    reasons.push("deploy_block_rate_signal_coverage_below_threshold");
  }
  if (sampleReady && signalCoverage.rollbackRate < thresholds.minSignalCoverageRate) {
    reasons.push("rollback_rate_signal_coverage_below_threshold");
  }
  if (sampleReady && signalCoverage.schemaBacklog < thresholds.minSignalCoverageRate) {
    reasons.push("schema_backlog_signal_coverage_below_threshold");
  }
  if (
    sampleReady &&
    signalCoverage.saveAsViewSuccessRate < thresholds.minSignalCoverageRate
  ) {
    reasons.push("save_as_view_signal_coverage_below_threshold");
  }
  if (
    sampleReady &&
    signalCoverage.runtimeRevisionMissingRate < thresholds.minSignalCoverageRate
  ) {
    reasons.push("runtime_revision_missing_signal_coverage_below_threshold");
  }
  if (sampleReady && deployBlockRate > thresholds.maxDeployBlockRate) {
    reasons.push("deploy_block_rate_exceeded");
  }
  if (sampleReady && rollbackRate > thresholds.maxRollbackRate) {
    reasons.push("rollback_rate_exceeded");
  }
  if (sampleReady && schemaBacklogAvg > thresholds.maxSchemaBacklogAvg) {
    reasons.push("schema_backlog_exceeded");
  }
  if (sampleReady && saveAsViewSuccessRate < thresholds.minSaveAsViewSuccessRate) {
    reasons.push("save_as_view_success_rate_below_threshold");
  }
  if (sampleReady && runtimeRevisionMissingRate > thresholds.maxRuntimeRevisionMissingRate) {
    reasons.push("runtime_revision_missing_rate_exceeded");
  }

  const latest = samples.at(-1);
  return {
    sampleSize,
    sampleReady,
    gatePass: sampleReady && reasons.length === 0,
    reasons,
    thresholds,
    signalCoverage,
    metrics: {
      deployBlockRate,
      rollbackRate,
      schemaBacklogAvg,
      saveAsViewSuccessRate,
      runtimeRevisionMissingRate
    },
    latest: latest
      ? {
          runId: latest.runId,
          datasourceId: latest.datasourceId,
          recordedAt: latest.recordedAt ?? new Date().toISOString(),
          metrics: {
            deployBlockRate: clampRatio(latest.deployBlockRate),
            rollbackRate: clampRatio(latest.rollbackRate),
            schemaBacklog: Math.max(0, toNumber(latest.schemaBacklog)),
            saveAsViewSuccessRate: clampRatio(latest.saveAsViewSuccessRate),
            runtimeRevisionMissingRate: clampRatio(latest.runtimeRevisionMissingRate)
          }
        }
      : undefined
  };
}

function evaluateRolloutDecision(gatePass, reasons) {
  const normalizedReasons = Array.isArray(reasons) ? reasons : [];
  const hasSampleNotReady = normalizedReasons.some((reason) =>
    reason.endsWith(":sample_not_ready")
  );
  const rollbackRiskReasons = normalizedReasons.filter((reason) =>
    reason.includes("rollback_rate_exceeded") ||
    reason.includes("runtime_revision_missing_rate_exceeded") ||
    reason.includes("deploy_block_rate_exceeded")
  );
  const rollbackSuggested = rollbackRiskReasons.length > 0;
  const recommendedStage = hasSampleNotReady
    ? "shadow_only"
    : rollbackSuggested
      ? "rollback_or_hold"
      : gatePass
        ? "canary_ready"
        : "hold";

  return {
    recommendedStage,
    canaryEligible: gatePass,
    rollbackSuggested,
    rollbackRiskReasons,
    runbook: {
      rollout: "README.md#modeling-parity-shadow-gate-rollout-runbook",
      rollback: "README.md#modeling-parity-shadow-gate-rollout-runbook"
    }
  };
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const failOnGateByArg = args.includes("--fail-on-gate");
  const positional = args.filter((item) => item !== "--fail-on-gate");
  const failOnGate = failOnGateByArg || parseBoolean(process.env.MODELING_PARITY_FAIL_ON_GATE);
  return { positional, failOnGate };
}

async function main() {
  const { positional, failOnGate } = parseCliArgs(process.argv);
  const relInput = resolve(positional[0] ?? DEFAULT_REL_INPUT);
  const relOutput = resolve(positional[1] ?? DEFAULT_REL_OUTPUT);
  const spineInput = resolve(positional[2] ?? DEFAULT_SPINE_INPUT);
  const spineOutput = resolve(positional[3] ?? DEFAULT_SPINE_OUTPUT);
  const modelingInput = resolve(positional[4] ?? DEFAULT_MODELING_INPUT);
  const outputPath = resolve(positional[5] ?? DEFAULT_OUTPUT);

  runScript(RELATIONSHIP_SCRIPT, [relInput, relOutput]);
  runScript(SEMANTIC_SPINE_SCRIPT, [spineInput, spineOutput]);

  const relationshipPlatform = await readJson(relOutput, {});
  const semanticSpine = await readJson(spineOutput, {});
  const modelingSamplesRaw = await readJson(modelingInput, []);
  const modelingSamples = Array.isArray(modelingSamplesRaw)
    ? modelingSamplesRaw
    : Array.isArray(modelingSamplesRaw?.samples)
      ? modelingSamplesRaw.samples
      : [];
  const modelingWorkspace = evaluateModelingWorkspace(
    modelingSamples,
    readModelingThresholds()
  );

  const relationshipPass = relationshipPlatform.gatePass === true;
  const semanticPass = semanticSpine.gatePass === true;
  const modelingPass = modelingWorkspace.gatePass === true;
  const gatePass = relationshipPass && semanticPass && modelingPass;
  const reasons = unique([
    ...normalizeReasons("relationship_platform", relationshipPlatform.reasons),
    ...normalizeReasons("semantic_spine", semanticSpine.reasons),
    ...normalizeReasons("modeling_workspace", modelingWorkspace.reasons)
  ]);
  const rollout = evaluateRolloutDecision(gatePass, reasons);

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      relationshipPlatform: relInput,
      semanticSpine: spineInput,
      modelingWorkspace: modelingInput
    },
    outputs: {
      relationshipPlatform: relOutput,
      semanticSpine: spineOutput,
      modelingWorkspace: outputPath
    },
    strictMode: failOnGate,
    gatePass,
    reasons,
    rollout,
    relationshipPlatform: {
      gatePass: relationshipPass,
      sampleSize:
        typeof relationshipPlatform.sampleSize === "number"
          ? relationshipPlatform.sampleSize
          : 0,
      sampleReady: relationshipPlatform.sampleReady === true,
      metrics: relationshipPlatform.metrics ?? {},
      thresholds: relationshipPlatform.thresholds ?? {},
      latest: relationshipPlatform.latest
    },
    semanticSpine: {
      gatePass: semanticPass,
      sampleSize:
        typeof semanticSpine.sampleSize === "number" ? semanticSpine.sampleSize : 0,
      sampleReady: semanticSpine.sampleReady === true,
      metrics: semanticSpine.metrics ?? {},
      thresholds: semanticSpine.thresholds ?? {},
      latest: semanticSpine.latest
    },
    modelingWorkspace: {
      gatePass: modelingPass,
      sampleSize: modelingWorkspace.sampleSize,
      sampleReady: modelingWorkspace.sampleReady,
      metrics: modelingWorkspace.metrics,
      signalCoverage: modelingWorkspace.signalCoverage,
      thresholds: modelingWorkspace.thresholds,
      latest: modelingWorkspace.latest
    }
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (failOnGate && !gatePass) {
    process.stderr.write(
      `modeling parity gate failed under --fail-on-gate mode: ${
        reasons.join(", ") || "unknown_reason"
      }\n`
    );
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exit(1);
});
