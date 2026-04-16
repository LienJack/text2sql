import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, ".env");
  const env: Record<string, string> = {};
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key) env[key] = value;
    }
  } catch {
    // .env not found — rely on process.env
  }
  return env;
}

function resolveDatabaseUrl(): string {
  const env = { ...loadEnv(), ...process.env };

  const explicit = (env.DATABASE_URL ?? "").trim();
  if (explicit) return explicit;

  const host = (env.POSTGRES_HOST ?? "localhost").trim();
  const port = (env.POSTGRES_PORT ?? "5432").trim();
  const db = (env.POSTGRES_DB ?? "").trim();
  const user = (env.POSTGRES_USER ?? "").trim();
  const password = (env.POSTGRES_PASSWORD ?? "").trim();
  const schema = (env.POSTGRES_SCHEMA ?? "public").trim();

  if (!host || !port || !db || !user || !password) return "";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}?schema=${encodeURIComponent(schema)}`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: resolveDatabaseUrl()
  }
});
