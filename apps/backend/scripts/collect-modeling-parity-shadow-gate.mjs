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

function clampRatio(value) {
  return Math.min(1, Math.max(0, toNumber(value, 0)));
}

function avg(values) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function readModelingThresholds() {
  return {
    minSamples: toNumber(process.env.MODELING_PARITY_MIN_SAMPLES, 30),
    maxDeployBlockRate: toNumber(process.env.MODELING_PARITY_MAX_DEPLOY_BLOCK_RATE, 0.4),
    maxSchemaBacklogAvg: toNumber(process.env.MODELING_PARITY_MAX_SCHEMA_BACKLOG_AVG, 2),
    minSaveAsViewSuccessRate: toNumber(
      process.env.MODELING_PARITY_MIN_SAVE_AS_VIEW_SUCCESS_RATE,
      0.8
    ),
    maxRuntimeRevisionMissingRate: toNumber(
      process.env.MODELING_PARITY_MAX_RUNTIME_REVISION_MISSING_RATE,
      0.1
    )
  };
}

function evaluateModelingWorkspace(samples, thresholds) {
  const sampleSize = samples.length;
  const sampleReady = sampleSize >= thresholds.minSamples;
  const deployBlockRate = avg(samples.map((item) => clampRatio(item.deployBlockRate)));
  const schemaBacklogAvg = avg(samples.map((item) => Math.max(0, toNumber(item.schemaBacklog))));
  const saveAsViewSuccessRate = avg(
    samples.map((item) => clampRatio(item.saveAsViewSuccessRate))
  );
  const runtimeRevisionMissingRate = avg(
    samples.map((item) => clampRatio(item.runtimeRevisionMissingRate))
  );

  const reasons = [];
  if (!sampleReady) {
    reasons.push("sample_not_ready");
  }
  if (sampleReady && deployBlockRate > thresholds.maxDeployBlockRate) {
    reasons.push("deploy_block_rate_exceeded");
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
    metrics: {
      deployBlockRate,
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
            schemaBacklog: Math.max(0, toNumber(latest.schemaBacklog)),
            saveAsViewSuccessRate: clampRatio(latest.saveAsViewSuccessRate),
            runtimeRevisionMissingRate: clampRatio(latest.runtimeRevisionMissingRate)
          }
        }
      : undefined
  };
}

async function main() {
  const relInput = resolve(process.argv[2] ?? DEFAULT_REL_INPUT);
  const relOutput = resolve(process.argv[3] ?? DEFAULT_REL_OUTPUT);
  const spineInput = resolve(process.argv[4] ?? DEFAULT_SPINE_INPUT);
  const spineOutput = resolve(process.argv[5] ?? DEFAULT_SPINE_OUTPUT);
  const modelingInput = resolve(process.argv[6] ?? DEFAULT_MODELING_INPUT);
  const outputPath = resolve(process.argv[7] ?? DEFAULT_OUTPUT);

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

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      relationshipPlatform: relInput,
      semanticSpine: spineInput
    },
    outputs: {
      relationshipPlatform: relOutput,
      semanticSpine: spineOutput
    },
    modelingWorkspaceInput: modelingInput,
    gatePass,
    reasons,
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
      thresholds: modelingWorkspace.thresholds,
      latest: modelingWorkspace.latest
    }
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exit(1);
});
