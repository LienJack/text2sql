import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import {
  SEMANTIC_ASSET_REINDEX_TRIGGERS,
  SemanticAssetReindexService,
  type SemanticAssetReindexTrigger
} from "../src/modules/knowledge/rag/retrieval/semantic-asset-reindex.service";

interface CliArgs {
  datasourceId: string;
  workspaceId?: string;
  triggers: SemanticAssetReindexTrigger[];
  reason?: string;
  runId?: string;
  force: boolean;
  sourceVersion?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"]
  });
  try {
    const service = app.get(SemanticAssetReindexService);
    const result = await service.reindex({
      datasourceId: args.datasourceId,
      workspaceId: args.workspaceId,
      triggers: args.triggers,
      reason: args.reason,
      runId: args.runId,
      force: args.force,
      sourceVersion: args.sourceVersion
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

function parseArgs(argv: string[]): CliArgs {
  const allowedTriggers = new Set(SEMANTIC_ASSET_REINDEX_TRIGGERS);
  const options = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options.set(key, [...(options.get(key) ?? []), "true"]);
      continue;
    }
    options.set(key, [...(options.get(key) ?? []), next]);
    index += 1;
  }

  const datasourceId = (options.get("datasource-id")?.[0] ?? "").trim();
  if (!datasourceId) {
    throw new Error("Missing required --datasource-id <value>");
  }

  const triggerInputs = options
    .get("trigger")
    ?.flatMap((value) => value.split(",").map((part) => part.trim()))
    .filter((value) => value.length > 0) ?? ["schema", "embedding_model"];

  const triggers = Array.from(
    new Set(
      triggerInputs.filter(
        (trigger): trigger is SemanticAssetReindexTrigger =>
          allowedTriggers.has(trigger as SemanticAssetReindexTrigger)
      )
    )
  );

  if (triggers.length === 0) {
    throw new Error(
      `No valid --trigger values provided. Allowed: ${SEMANTIC_ASSET_REINDEX_TRIGGERS.join(", ")}`
    );
  }

  return {
    datasourceId,
    workspaceId: options.get("workspace-id")?.[0]?.trim(),
    triggers,
    reason: options.get("reason")?.[0]?.trim(),
    runId: options.get("run-id")?.[0]?.trim(),
    sourceVersion: options.get("source-version")?.[0]?.trim(),
    force: options.has("force")
  };
}

void main();
