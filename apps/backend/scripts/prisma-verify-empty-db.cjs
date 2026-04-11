#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { resolve } = require("node:path");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureSafeDatabaseName(name) {
  if (!name) {
    fail("DATABASE_URL 未包含数据库名。");
  }
  if (name === "postgres") {
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

async function recreateDatabase() {
  const targetUrl = (process.env.DATABASE_URL || "").trim();
  if (!targetUrl) {
    fail("DATABASE_URL 为空，无法执行空库回放校验。");
  }

  const parsed = new URL(targetUrl);
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
  await recreateDatabase();
  runPrisma(["migrate", "deploy"]);
  runPrisma(["migrate", "status"]);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
