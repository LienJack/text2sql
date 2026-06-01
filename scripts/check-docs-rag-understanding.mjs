#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";

const parseRootArg = () => {
  const args = process.argv.slice(2);
  const index = args.findIndex((item) => item === "--root");
  if (index >= 0 && args[index + 1]) {
    return path.resolve(args[index + 1]);
  }
  return process.cwd();
};

const ROOT = parseRootArg();

const DOC_RULES = [
  {
    file: "docs/rag-understanding/text2sql-rag-end-to-end-understanding.md",
    sections: [
      "## Overview",
      "## Flow",
      "## Contracts",
      "## Failure Modes",
      "## Verification"
    ],
    anchors: [
      "selected_context",
      "manifest fingerprint",
      "prepared asset family",
      "AgentRunResponse",
      "ChatStreamEvent",
      "TABLE_PERMISSIONS_FORBIDDEN",
      "/api/v1/rag/quality/replay/:runId"
    ]
  },
  {
    file: "docs/rag-understanding/text2sql-rag-runid-replay-handbook.md",
    sections: [
      "## Overview",
      "## Flow",
      "## Contracts",
      "## Failure Modes",
      "## Verification"
    ],
    anchors: [
      "runId",
      "selected_context",
      "manifest fingerprint",
      "prepared asset family",
      "retrieval_fused",
      "rerank_finalized",
      "/api/v1/runs/<runId>"
    ]
  },
  {
    file: "docs/rag-understanding/text2sql-rag-local-learning-lab.md",
    sections: [
      "## Overview",
      "## Flow",
      "## Contracts",
      "## Failure Modes",
      "## Verification"
    ],
    anchors: [
      "runId",
      "selected_context",
      "/api/v1/sessions/:sessionId/messages",
      "/api/v1/sessions/:sessionId/messages/stream",
      "/api/v1/rag/quality/replay/<runId>"
    ]
  }
];

const NAV_RULES = [
  {
    file: "README.md",
    anchors: [
      "docs/rag-understanding/text2sql-rag-end-to-end-understanding.md",
      "docs/rag-understanding/text2sql-rag-runid-replay-handbook.md",
      "docs/rag-understanding/text2sql-rag-local-learning-lab.md"
    ]
  },
  {
    file: "AGENTS.md",
    anchors: [
      "docs/rag-understanding/text2sql-rag-end-to-end-understanding.md",
      "docs/rag-understanding/text2sql-rag-runid-replay-handbook.md",
      "docs/rag-understanding/text2sql-rag-local-learning-lab.md"
    ]
  }
];

const failures = [];

const fail = (code, detail) => {
  failures.push({ code, detail });
  console.error(`[FAIL] ${code}: ${detail}`);
};

const pass = (detail) => {
  console.log(`[PASS] ${detail}`);
};

const readText = async (relativePath) => {
  const absolutePath = path.join(ROOT, relativePath);
  await access(absolutePath);
  return readFile(absolutePath, "utf8");
};

const checkDocRule = async (rule) => {
  let text = "";
  try {
    text = await readText(rule.file);
    pass(`file exists: ${rule.file}`);
  } catch {
    fail("missing_file", rule.file);
    return;
  }

  for (const section of rule.sections) {
    if (!text.includes(section)) {
      fail("missing_section", `${rule.file} -> ${section}`);
    } else {
      pass(`section ok: ${rule.file} -> ${section}`);
    }
  }

  for (const anchor of rule.anchors) {
    if (!text.includes(anchor)) {
      fail("missing_anchor", `${rule.file} -> ${anchor}`);
    } else {
      pass(`anchor ok: ${rule.file} -> ${anchor}`);
    }
  }
};

const checkNavRule = async (rule) => {
  let text = "";
  try {
    text = await readText(rule.file);
    pass(`nav file exists: ${rule.file}`);
  } catch {
    fail("missing_file", rule.file);
    return;
  }

  for (const anchor of rule.anchors) {
    if (!text.includes(anchor)) {
      fail("missing_nav_anchor", `${rule.file} -> ${anchor}`);
    } else {
      pass(`nav anchor ok: ${rule.file} -> ${anchor}`);
    }
  }
};

const main = async () => {
  console.log(`[INFO] checking docs contract under root=${ROOT}`);
  for (const rule of DOC_RULES) {
    await checkDocRule(rule);
  }
  for (const rule of NAV_RULES) {
    await checkNavRule(rule);
  }

  if (failures.length > 0) {
    console.error(`[SUMMARY] failed checks=${failures.length}`);
    process.exit(1);
  }

  console.log("[SUMMARY] docs-rag-understanding contract check passed");
};

await main();
