import { v4 as uuidv4 } from "uuid";
import { AppConfigService } from "../../src/modules/config/app-config.service";
import { AnalysisLedgerPrismaService } from "../../src/modules/platform/data/persistence/analysis-ledger-prisma.service";

export type AnalysisLedgerTestHarness = {
  config: AppConfigService;
  prisma: AnalysisLedgerPrismaService;
  workspaceId: string;
  close: () => Promise<void>;
};

export const createAnalysisLedgerTestHarness = async (): Promise<AnalysisLedgerTestHarness> => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for analysis ledger integration tests");
  }
  const config = {
    databaseUrl,
    analysisArtifactMaxBytes: 64 * 1024,
    analysisTaskArtifactMaxBytes: 512 * 1024
  } as AppConfigService;
  const prisma = new AnalysisLedgerPrismaService(config);
  await prisma.onModuleInit();
  const workspaceId = `analysis-ledger-test-${uuidv4()}`;
  await prisma.requireClient().workspace.create({
    data: {
      id: workspaceId,
      name: workspaceId,
      status: "active",
      isDefault: false
    }
  });
  return {
    config,
    prisma,
    workspaceId,
    close: async () => {
      await prisma.requireClient().analysisTask.deleteMany({
        where: { workspaceId }
      });
      await prisma.requireClient().workspace.deleteMany({
        where: { id: workspaceId }
      });
      await prisma.onModuleDestroy();
    }
  };
};

export const buildGoalContract = (workspaceId: string) => ({
  version: "analysis-goal.v1" as const,
  objective: "解释本季度收入下降",
  decisionUse: "决定下季度产品与渠道投入",
  workspaceId,
  datasourceIds: ["sqlite_main"],
  allowedSourceKinds: ["database", "web"],
  deliverables: ["evidence_report"],
  budget: {
    maxDurationMs: 60_000,
    maxTokenCount: 10_000,
    maxQueryCount: 10,
    maxSearchCount: 10,
    maxArtifactBytes: 512 * 1024
  },
  riskLevel: "medium" as const,
  stopConditions: ["mandatory_obligations_closed", "budget_exhausted"]
});
