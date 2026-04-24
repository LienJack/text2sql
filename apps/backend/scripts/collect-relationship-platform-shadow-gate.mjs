#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_INPUT = resolve(
  process.cwd(),
  "data/reports/relationship-platform-shadow/samples.json"
);
const DEFAULT_OUTPUT = resolve(
  process.cwd(),
  "data/reports/relationship-platform-shadow/gate-summary.json"
);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampRatio(value) {
  return Math.max(0, Math.min(1, toNumber(value, 0)));
}

function avg(values) {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function readThresholds() {
  return {
    minSamples: toNumber(process.env.REL_PLATFORM_MIN_SAMPLES, 30),
    minMultiTableSuccessRate: toNumber(process.env.REL_PLATFORM_MIN_MULTI_TABLE_SUCCESS_RATE, 0.85),
    minRelationshipPublishSuccessRate: toNumber(
      process.env.REL_PLATFORM_MIN_PUBLISH_SUCCESS_RATE,
      0.95
    ),
    maxPublishBlockRate: toNumber(process.env.REL_PLATFORM_MAX_PUBLISH_BLOCK_RATE, 0.35),
    maxRollbackRate: toNumber(process.env.REL_PLATFORM_MAX_ROLLBACK_RATE, 0.1),
    minCrossDbCoverageRate: toNumber(process.env.REL_PLATFORM_MIN_CROSS_DB_COVERAGE_RATE, 0.2),
    minCorrectionSuccessRate: toNumber(process.env.REL_PLATFORM_MIN_CORRECTION_SUCCESS_RATE, 0.5)
  };
}

function evaluate(samples, thresholds) {
  const sampleSize = samples.length;
  const sampleReady = sampleSize >= thresholds.minSamples;

  const multiTableSuccessRate = avg(samples.map((item) => clampRatio(item.multiTableSuccessRate)));
  const relationshipPublishSuccessRate = avg(
    samples.map((item) => clampRatio(item.relationshipPublishSuccessRate))
  );
  const publishBlockRate = avg(samples.map((item) => clampRatio(item.publishBlockRate)));
  const rollbackRate = avg(samples.map((item) => clampRatio(item.rollbackRate)));
  const crossDbRelationshipCoverageRate = avg(
    samples.map((item) => clampRatio(item.crossDbRelationshipCoverageRate))
  );
  const correctionSuccessRate = avg(samples.map((item) => clampRatio(item.correctionSuccessRate)));

  const reasons = [];
  if (!sampleReady) {
    reasons.push("sample_not_ready");
  }
  if (sampleReady && multiTableSuccessRate < thresholds.minMultiTableSuccessRate) {
    reasons.push("multi_table_success_rate_below_threshold");
  }
  if (
    sampleReady &&
    relationshipPublishSuccessRate < thresholds.minRelationshipPublishSuccessRate
  ) {
    reasons.push("relationship_publish_success_rate_below_threshold");
  }
  if (sampleReady && publishBlockRate > thresholds.maxPublishBlockRate) {
    reasons.push("publish_block_rate_exceeded");
  }
  if (sampleReady && rollbackRate > thresholds.maxRollbackRate) {
    reasons.push("rollback_rate_exceeded");
  }
  if (sampleReady && crossDbRelationshipCoverageRate < thresholds.minCrossDbCoverageRate) {
    reasons.push("cross_db_relationship_coverage_rate_below_threshold");
  }
  if (sampleReady && correctionSuccessRate < thresholds.minCorrectionSuccessRate) {
    reasons.push("correction_success_rate_below_threshold");
  }

  const latest = samples.at(-1);

  return {
    sampleSize,
    sampleReady,
    gatePass: sampleReady && reasons.length === 0,
    reasons,
    metrics: {
      multiTableSuccessRate,
      relationshipPublishSuccessRate,
      publishBlockRate,
      rollbackRate,
      crossDbRelationshipCoverageRate,
      correctionSuccessRate
    },
    latest: latest
      ? {
          runId: latest.runId,
          datasourceId: latest.datasourceId,
          recordedAt: latest.recordedAt ?? new Date().toISOString(),
          metrics: {
            multiTableSuccessRate: clampRatio(latest.multiTableSuccessRate),
            relationshipPublishSuccessRate: clampRatio(latest.relationshipPublishSuccessRate),
            publishBlockRate: clampRatio(latest.publishBlockRate),
            rollbackRate: clampRatio(latest.rollbackRate),
            crossDbRelationshipCoverageRate: clampRatio(
              latest.crossDbRelationshipCoverageRate
            ),
            correctionSuccessRate: clampRatio(latest.correctionSuccessRate)
          }
        }
      : undefined
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
