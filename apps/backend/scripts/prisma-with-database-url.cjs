#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function loadDotenvFiles() {
  const cwd = process.cwd();
  const candidates = [".env", ".env.local"];
  for (const file of candidates) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) {
      continue;
    }
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) {
        continue;
      }
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function buildDatabaseUrl(env) {
  const host = (env.POSTGRES_HOST || "localhost").trim();
  const port = (env.POSTGRES_PORT || "5432").trim();
  const database = (env.POSTGRES_DB || "").trim();
  const user = (env.POSTGRES_USER || "").trim();
  const password = (env.POSTGRES_PASSWORD || "").trim();
  const schema = (env.POSTGRES_SCHEMA || "public").trim();

  if (!host || !port || !database || !user || !password) {
    return "";
  }

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
    password
  )}@${host}:${port}/${database}?schema=${encodeURIComponent(schema || "public")}`;
}

function main() {
  loadDotenvFiles();

  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: node scripts/prisma-with-database-url.cjs <prisma args...>"
    );
    process.exit(1);
  }

  const env = { ...process.env };
  if (!env.DATABASE_URL || !env.DATABASE_URL.trim()) {
    const derived = buildDatabaseUrl(env);
    if (!derived) {
      console.error(
        "DATABASE_URL 为空，且无法从 POSTGRES_* 组装。请设置 POSTGRES_HOST/PORT/DB/USER/PASSWORD。"
      );
      process.exit(1);
    }
    env.DATABASE_URL = derived;
  }

  let result;
  try {
    const prismaCliPath = require.resolve("prisma/build/index.js", {
      paths: [process.cwd()]
    });
    result = spawnSync(process.execPath, [prismaCliPath, ...args], {
      stdio: "inherit",
      env
    });
  } catch (_error) {
    const prismaBin = process.platform === "win32" ? "prisma.cmd" : "prisma";
    result = spawnSync(prismaBin, args, {
      stdio: "inherit",
      env
    });
  }

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

main();
