#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = process.cwd();
const CHECK_SCRIPT = path.join(REPO_ROOT, "scripts/check-docs-rag-understanding.mjs");

const REQUIRED_FILES = [
  "README.md",
  "AGENTS.md",
  "docs/rag-understanding/text2sql-rag-end-to-end-understanding.md",
  "docs/rag-understanding/text2sql-rag-runid-replay-handbook.md",
  "docs/rag-understanding/text2sql-rag-local-learning-lab.md"
];

const failures = [];

const logPass = (scope, detail) => {
  console.log(`[PASS] ${scope}: ${detail}`);
};

const logFail = (scope, detail) => {
  failures.push(`${scope}: ${detail}`);
  console.error(`[FAIL] ${scope}: ${detail}`);
};

const runCheck = (root) => {
  const result = spawnSync(process.execPath, [CHECK_SCRIPT, "--root", root], {
    encoding: "utf8"
  });
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`
  };
};

const prepareFixtureRoot = async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "docs-rag-contract-"));
  for (const relativePath of REQUIRED_FILES) {
    const sourcePath = path.join(REPO_ROOT, relativePath);
    const targetPath = path.join(tempRoot, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    const content = await readFile(sourcePath, "utf8");
    await writeFile(targetPath, content, "utf8");
  }
  return tempRoot;
};

const expectSuccess = (scope, result) => {
  if (result.code !== 0) {
    logFail(scope, `expected success, got code=${result.code}\n${result.output}`);
    return;
  }
  logPass(scope, "passed as expected");
};

const expectFailureWithCode = (scope, result, expectedCode) => {
  if (result.code === 0) {
    logFail(scope, `expected failure(${expectedCode}), got success`);
    return;
  }
  if (!result.output.includes(expectedCode)) {
    logFail(scope, `expected output to include ${expectedCode}\n${result.output}`);
    return;
  }
  logPass(scope, `failed with expected signal=${expectedCode}`);
};

const main = async () => {
  const happy = runCheck(REPO_ROOT);
  expectSuccess("happy_path", happy);

  const missingFileRoot = await prepareFixtureRoot();
  try {
    await rm(
      path.join(
        missingFileRoot,
        "docs/rag-understanding/text2sql-rag-end-to-end-understanding.md"
      )
    );
    const result = runCheck(missingFileRoot);
    expectFailureWithCode("missing_file", result, "missing_file");
  } finally {
    await rm(missingFileRoot, { recursive: true, force: true });
  }

  const missingSectionRoot = await prepareFixtureRoot();
  try {
    const filePath = path.join(
      missingSectionRoot,
      "docs/rag-understanding/text2sql-rag-runid-replay-handbook.md"
    );
    const original = await readFile(filePath, "utf8");
    await writeFile(filePath, original.replace("## Contracts", "## ContractX"), "utf8");
    const result = runCheck(missingSectionRoot);
    expectFailureWithCode("missing_section", result, "missing_section");
  } finally {
    await rm(missingSectionRoot, { recursive: true, force: true });
  }

  const missingAnchorRoot = await prepareFixtureRoot();
  try {
    const filePath = path.join(
      missingAnchorRoot,
      "docs/rag-understanding/text2sql-rag-end-to-end-understanding.md"
    );
    const original = await readFile(filePath, "utf8");
    await writeFile(
      filePath,
      original.replace(/selected_context/g, "selected-context"),
      "utf8"
    );
    const result = runCheck(missingAnchorRoot);
    expectFailureWithCode("missing_anchor", result, "missing_anchor");
  } finally {
    await rm(missingAnchorRoot, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`[SUMMARY] failed=${failures.length}`);
    process.exit(1);
  }

  console.log("[SUMMARY] docs-rag-understanding smoke passed");
};

await main();
