import { Client } from "langsmith";
import { computeLangsmithCoverage } from "../src/modules/observability/langsmith-coverage";

interface ScriptArgs {
  total: number;
  threshold: number;
  minSampleSize: number;
  lookbackHours: number;
  project: string;
}

const parseArgs = (): ScriptArgs => {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    if (index === -1 || index + 1 >= args.length) {
      return undefined;
    }
    return args[index + 1];
  };

  const totalRaw = get("--total");
  if (!totalRaw) {
    throw new Error(
      "Missing --total. Example: ts-node apps/backend/scripts/langsmith-coverage-check.ts --total 120"
    );
  }

  const threshold = Number(get("--threshold") ?? "0.95");
  const minSampleSize = Number(get("--min-sample-size") ?? "20");
  const lookbackHours = Number(get("--lookback-hours") ?? "24");
  const project = get("--project") ?? process.env.LANGSMITH_PROJECT ?? "text2sql";

  return {
    total: Number(totalRaw),
    threshold,
    minSampleSize,
    lookbackHours,
    project
  };
};

const countTracedRuns = async (
  client: Client,
  project: string,
  lookbackHours: number
): Promise<number> => {
  const startTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  let count = 0;
  for await (const run of client.listRuns({
    projectName: project,
    isRoot: true,
    startTime,
    limit: 5000
  })) {
    const tags = run.tags ?? [];
    if (tags.includes("source:chat") || tags.includes("source:evaluation")) {
      count += 1;
    }
  }
  return count;
};

const main = async (): Promise<void> => {
  const args = parseArgs();
  if (!process.env.LANGSMITH_API_KEY) {
    throw new Error("LANGSMITH_API_KEY is required.");
  }

  const client = new Client({
    apiKey: process.env.LANGSMITH_API_KEY,
    apiUrl: process.env.LANGSMITH_ENDPOINT,
    workspaceId: process.env.LANGSMITH_WORKSPACE_ID
  });

  const traced = await countTracedRuns(client, args.project, args.lookbackHours);
  const result = computeLangsmithCoverage({
    totalExecutableRequests: args.total,
    tracedRequests: traced,
    threshold: args.threshold,
    minSampleSize: args.minSampleSize
  });

  const summary = {
    project: args.project,
    lookbackHours: args.lookbackHours,
    ...result
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!result.pass) {
    process.exitCode = 1;
  }
};

void main();
