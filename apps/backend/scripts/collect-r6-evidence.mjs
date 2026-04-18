#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_EVIDENCE_FILES = [
  "gate-summary.json",
  "cache-budget-validation.json",
  "graph-fallback-chaos.json",
  "release-checklist.md",
  "rollback-rehearsal.md"
];

const REQUIRED_GATE_FIELDS = [
  "generatedAt",
  "releaseCandidate",
  "sampleReady",
  "gatePass",
  "gateDecision",
  "metrics",
  "blockReasons",
  "freezeReasons",
  "rollbackReasons",
  "evidenceRefs"
];

const VALID_GATE_DECISIONS = new Set(["pass", "freeze", "block", "rollback"]);

await run();

async function run() {
  try {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const repoRoot = resolve(scriptDir, "../../..");
    const reportDir = resolve(
      process.env.R6_REPORT_DIR?.trim() || join(repoRoot, "data/reports/r6")
    );
    const archiveRoot = resolve(
      process.env.R6_EVIDENCE_ARCHIVE_DIR?.trim() || join(reportDir, "archive")
    );
    const evidenceRefPrefix = normalizeEvidenceRefPrefix(
      process.env.R6_EVIDENCE_REF_PREFIX?.trim() || "data/reports/r6"
    );
    const releaseCandidate = sanitizeToken(
      process.env.RELEASE_CANDIDATE?.trim() || "r6-local"
    );
    const generatedAt = resolveIsoTimestamp(process.env.R6_EVIDENCE_TIMESTAMP?.trim());
    const gateSummaryPath = join(reportDir, "gate-summary.json");
    const reasons = await collectIncompleteReasons({
      reportDir,
      gateSummaryPath,
      evidenceRefPrefix
    });

    if (reasons.length > 0) {
      failAndExit({
        status: "incomplete",
        incomplete: true,
        reportDir,
        gateSummaryPath,
        reasons
      });
      return;
    }

    const archiveDir = join(
      archiveRoot,
      releaseCandidate,
      toArchiveStamp(generatedAt)
    );
    await mkdir(archiveDir, { recursive: true });

    const artifactManifests = [];
    for (const fileName of REQUIRED_EVIDENCE_FILES) {
      const sourcePath = join(reportDir, fileName);
      const archivePath = join(archiveDir, fileName);
      await copyFile(sourcePath, archivePath);
      const sourceStats = await stat(sourcePath);
      artifactManifests.push({
        fileName,
        sourcePath,
        archivePath,
        sizeBytes: sourceStats.size,
        sha256: await sha256File(sourcePath)
      });
    }

    const gateSummaryRaw = await readFile(gateSummaryPath, "utf8");
    const gateSummary = JSON.parse(gateSummaryRaw);

    const manifest = {
      version: 1,
      generatedAt,
      releaseCandidate,
      reportDir,
      archiveDir,
      incomplete: false,
      gate: {
        gateDecision: gateSummary.gateDecision,
        gatePass: gateSummary.gatePass,
        sampleReady: gateSummary.sampleReady
      },
      artifacts: artifactManifests
    };

    const manifestPath = join(archiveDir, "release-evidence-manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    await writeFile(
      join(reportDir, "release-evidence-latest.json"),
      JSON.stringify(
        {
          generatedAt,
          releaseCandidate,
          manifestPath,
          archiveDir,
          incomplete: false
        },
        null,
        2
      ),
      "utf8"
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ok",
          generatedAt,
          releaseCandidate,
          archiveDir,
          manifestPath
        },
        null,
        2
      )}\n`
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    failAndExit({
      status: "failed",
      incomplete: true,
      reasons: [`collector_runtime_error:${detail}`]
    });
  }
}

async function collectIncompleteReasons(input) {
  const reasons = [];
  const gateSummary = await readGateSummary(input.gateSummaryPath, reasons);
  if (!gateSummary) {
    return reasons;
  }

  validateGateSummary(gateSummary, input.evidenceRefPrefix, reasons);
  await validateEvidenceFiles(input.reportDir, input.evidenceRefPrefix, reasons);

  return reasons;
}

async function readGateSummary(gateSummaryPath, reasons) {
  try {
    await access(gateSummaryPath, fsConstants.R_OK);
  } catch {
    reasons.push("missing_evidence:data/reports/r6/gate-summary.json");
    return null;
  }

  let parsed;
  try {
    const raw = await readFile(gateSummaryPath, "utf8");
    parsed = JSON.parse(raw);
  } catch {
    reasons.push("invalid_gate_summary_json");
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    reasons.push("invalid_gate_summary_shape");
    return null;
  }

  return parsed;
}

function validateGateSummary(gateSummary, evidenceRefPrefix, reasons) {
  for (const field of REQUIRED_GATE_FIELDS) {
    if (!(field in gateSummary)) {
      reasons.push(`gate_summary_missing_field:${field}`);
    }
  }

  if (!VALID_GATE_DECISIONS.has(gateSummary.gateDecision)) {
    reasons.push(`gate_summary_invalid_gateDecision:${String(gateSummary.gateDecision)}`);
  }

  if (!Array.isArray(gateSummary.evidenceRefs)) {
    reasons.push("gate_summary_invalid_evidenceRefs");
    return;
  }

  for (const fileName of REQUIRED_EVIDENCE_FILES) {
    const expectedRef = `${evidenceRefPrefix}/${fileName}`;
    if (!gateSummary.evidenceRefs.includes(expectedRef)) {
      reasons.push(`gate_summary_missing_evidence_ref:${expectedRef}`);
    }
  }
}

async function validateEvidenceFiles(reportDir, evidenceRefPrefix, reasons) {
  for (const fileName of REQUIRED_EVIDENCE_FILES) {
    const filePath = join(reportDir, fileName);
    const reference = `${evidenceRefPrefix}/${fileName}`;
    try {
      await access(filePath, fsConstants.R_OK);
      const stats = await stat(filePath);
      if (stats.size <= 0) {
        reasons.push(`empty_evidence:${reference}`);
      }
    } catch {
      reasons.push(`missing_evidence:${reference}`);
    }
  }
}

function normalizeEvidenceRefPrefix(input) {
  const trimmed = input.replaceAll("\\", "/").trim();
  return trimmed.replace(/\/+$/, "");
}

function resolveIsoTimestamp(value) {
  if (!value) {
    return new Date().toISOString();
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

function toArchiveStamp(isoTimestamp) {
  return isoTimestamp.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sanitizeToken(input) {
  const value = input.trim();
  if (!value) {
    return "r6-local";
  }
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function sha256File(filePath) {
  const payload = await readFile(filePath);
  return createHash("sha256").update(payload).digest("hex");
}

function failAndExit(payload) {
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
}
