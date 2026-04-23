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

async function main() {
  const relInput = resolve(process.argv[2] ?? DEFAULT_REL_INPUT);
  const relOutput = resolve(process.argv[3] ?? DEFAULT_REL_OUTPUT);
  const spineInput = resolve(process.argv[4] ?? DEFAULT_SPINE_INPUT);
  const spineOutput = resolve(process.argv[5] ?? DEFAULT_SPINE_OUTPUT);
  const outputPath = resolve(process.argv[6] ?? DEFAULT_OUTPUT);

  runScript(RELATIONSHIP_SCRIPT, [relInput, relOutput]);
  runScript(SEMANTIC_SPINE_SCRIPT, [spineInput, spineOutput]);

  const relationshipPlatform = await readJson(relOutput, {});
  const semanticSpine = await readJson(spineOutput, {});

  const relationshipPass = relationshipPlatform.gatePass === true;
  const semanticPass = semanticSpine.gatePass === true;
  const gatePass = relationshipPass && semanticPass;
  const reasons = unique([
    ...normalizeReasons("relationship_platform", relationshipPlatform.reasons),
    ...normalizeReasons("semantic_spine", semanticSpine.reasons)
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
