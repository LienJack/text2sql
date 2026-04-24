#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const DEFAULT_INPUT = resolve(
  process.cwd(),
  "data/reports/semantic-spine-shadow/samples.json"
);
const DEFAULT_OUTPUT = resolve(
  process.cwd(),
  "data/reports/semantic-spine-shadow/gate-summary.json"
);

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

function p95(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return Number(sorted[Math.max(0, Math.min(index, sorted.length - 1))].toFixed(3));
}

function readThresholds() {
  return {
    minSamples: toNumber(process.env.AGENT_SML_SPINE_MIN_SAMPLES, 30),
    minAccuracyLift: toNumber(process.env.AGENT_SML_SPINE_MIN_ACCURACY_LIFT, 0.12),
    minSemanticConsistencyLift: toNumber(
      process.env.AGENT_SML_SPINE_MIN_SEMANTIC_CONSISTENCY_LIFT,
      0.12
    ),
    maxLatencyOverheadMsP95: toNumber(
      process.env.AGENT_SML_SPINE_MAX_LATENCY_OVERHEAD_MS_P95,
      180
    ),
    maxDegradeRate: toNumber(process.env.AGENT_SML_SPINE_MAX_DEGRADE_RATE, 0.1)
  };
}

function evaluate(samples, thresholds) {
  const sampleSize = samples.length;
  const sampleReady = sampleSize >= thresholds.minSamples;
  const accuracyLiftAvg = avg(samples.map((item) => clampRatio(item.accuracyLift)));
  const semanticConsistencyLiftAvg = avg(
    samples.map((item) => clampRatio(item.semanticConsistencyLift))
  );
  const latencyP95OverheadMs = p95(samples.map((item) => Math.max(0, toNumber(item.latencyOverheadMs))));
  const degradeRateAvg = avg(samples.map((item) => clampRatio(item.degradeRate)));

  const reasons = [];
  if (!sampleReady) {
    reasons.push("sample_not_ready");
  }
  if (sampleReady && accuracyLiftAvg < thresholds.minAccuracyLift) {
    reasons.push("accuracy_lift_below_threshold");
  }
  if (sampleReady && semanticConsistencyLiftAvg < thresholds.minSemanticConsistencyLift) {
    reasons.push("semantic_consistency_lift_below_threshold");
  }
  if (sampleReady && latencyP95OverheadMs > thresholds.maxLatencyOverheadMsP95) {
    reasons.push("latency_overhead_p95_exceeded");
  }
  if (sampleReady && degradeRateAvg > thresholds.maxDegradeRate) {
    reasons.push("degrade_rate_exceeded");
  }

  const latest = samples.at(-1);

  return {
    sampleSize,
    sampleReady,
    gatePass: sampleReady && reasons.length === 0,
    reasons,
    latest: latest
      ? {
          runId: latest.runId,
          datasourceId: latest.datasourceId,
          recordedAt: latest.recordedAt ?? new Date().toISOString(),
          metrics: {
            accuracyLift: clampRatio(latest.accuracyLift),
            semanticConsistencyLift: clampRatio(latest.semanticConsistencyLift),
            latencyOverheadMs: Math.max(0, toNumber(latest.latencyOverheadMs)),
            degradeRate: clampRatio(latest.degradeRate)
          }
        }
      : undefined,
    metrics: {
      accuracyLiftAvg,
      semanticConsistencyLiftAvg,
      latencyP95OverheadMs,
      degradeRateAvg
    }
  };
}

async function main() {
  const inputPath = resolve(process.argv[2] ?? DEFAULT_INPUT);
  const outputPath = resolve(process.argv[3] ?? DEFAULT_OUTPUT);
  const thresholds = readThresholds();
  let samples = [];

  try {
    const raw = await readFile(inputPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      samples = parsed;
    } else if (Array.isArray(parsed?.samples)) {
      samples = parsed.samples;
    }
  } catch {
    samples = [];
  }

  const report = {
    generatedAt: new Date().toISOString(),
    inputPath,
    thresholds,
    ...evaluate(samples, thresholds)
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
