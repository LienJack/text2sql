#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { Client } = require("pg");
const { resolve } = require("node:path");

function fail(message) {
  console.error(message);
  process.exit(1);
}

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

function ensureSafeDatabaseName(name) {
  if (!name) {
    fail("DATABASE_URL 未包含数据库名。");
  }
  if (name.toLowerCase() === "postgres") {
    fail("DATABASE_URL 不能指向 postgres 管理库。");
  }
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    fail(
      `数据库名 "${name}" 含非法字符。仅支持字母、数字与下划线，避免 SQL 注入风险。`
    );
  }
}

function runPrisma(args) {
  const scriptPath = resolve(__dirname, "prisma-with-database-url.cjs");
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    fail(result.error.message);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveTargetDatabaseUrl() {
  const explicitUrl = (process.env.DATABASE_URL || "").trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  const derivedUrl = buildDatabaseUrl(process.env);
  if (!derivedUrl) {
    fail(
      "DATABASE_URL 为空，且无法从 POSTGRES_* 组装。请设置 POSTGRES_HOST/PORT/DB/USER/PASSWORD。"
    );
  }

  process.env.DATABASE_URL = derivedUrl;
  return derivedUrl;
}

async function recreateDatabase() {
  const targetUrl = resolveTargetDatabaseUrl();

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (_error) {
    fail("DATABASE_URL 非法，无法解析。");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  ensureSafeDatabaseName(databaseName);

  const adminUrl = new URL(targetUrl);
  adminUrl.pathname = "/postgres";

  const client = new Client({
    connectionString: adminUrl.toString()
  });

  try {
    await client.connect();
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
      [databaseName]
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }
}

async function main() {
  loadDotenvFiles();
  await recreateDatabase();
  runPrisma(["migrate", "deploy"]);
  runPrisma(["migrate", "status"]);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
