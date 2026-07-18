import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DomainError } from "../../../../common/domain-error";
import { AppConfigService } from "../../../config/app-config.service";

export type AnalysisPrismaDelegate = {
  findUnique: (args: Record<string, unknown>) => Promise<unknown>;
  findFirst: (args: Record<string, unknown>) => Promise<unknown>;
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
  create: (args: Record<string, unknown>) => Promise<unknown>;
  upsert: (args: Record<string, unknown>) => Promise<unknown>;
  update: (args: Record<string, unknown>) => Promise<unknown>;
  updateMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
  aggregate: (args: Record<string, unknown>) => Promise<unknown>;
  deleteMany: (args: Record<string, unknown>) => Promise<{ count: number }>;
};

export type AnalysisPrismaClient = {
  workspace: AnalysisPrismaDelegate;
  workspaceMember: AnalysisPrismaDelegate;
  platformUser: AnalysisPrismaDelegate;
  analysisTask: AnalysisPrismaDelegate;
  analysisTaskRevision: AnalysisPrismaDelegate;
  analysisAttempt: AnalysisPrismaDelegate;
  analysisEvent: AnalysisPrismaDelegate;
  analysisArtifact: AnalysisPrismaDelegate;
  analysisArtifactPayload: AnalysisPrismaDelegate;
  analysisArtifactLink: AnalysisPrismaDelegate;
  analysisReceipt: AnalysisPrismaDelegate;
  analysisDecision: AnalysisPrismaDelegate;
  analysisManifest: AnalysisPrismaDelegate;
  analysisCommandOutbox: AnalysisPrismaDelegate;
  researchConnectorConfig: AnalysisPrismaDelegate;
  researchSourcePolicy: AnalysisPrismaDelegate;
  researchSourceSnapshot: AnalysisPrismaDelegate;
  knowledgeAsset: AnalysisPrismaDelegate;
  knowledgeAssetTransition: AnalysisPrismaDelegate;
  $transaction: <T>(
    operation: (transaction: AnalysisPrismaClient) => Promise<T>
  ) => Promise<T>;
  $disconnect: () => Promise<void>;
};

@Injectable()
export class AnalysisLedgerPrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisLedgerPrismaService.name);
  private client?: AnalysisPrismaClient;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.databaseUrl) {
      this.logger.warn(
        "Analysis ledger 需要 PostgreSQL；当前未配置 DATABASE_URL，自治分析 API 将 fail closed。"
      );
      return;
    }
    try {
      const prismaClientModulePath = "../../../../generated/prisma/client";
      const prismaModule = (await import(prismaClientModulePath)) as unknown as {
        PrismaClient?: new (...args: unknown[]) => AnalysisPrismaClient;
        default?: {
          PrismaClient?: new (...args: unknown[]) => AnalysisPrismaClient;
        };
      };
      const adapterModule = (await import("@prisma/adapter-pg")) as unknown as {
        PrismaPg?: new (...args: unknown[]) => unknown;
        default?: { PrismaPg?: new (...args: unknown[]) => unknown };
      };
      const PrismaCtor = prismaModule.PrismaClient ?? prismaModule.default?.PrismaClient;
      const PrismaPgCtor = adapterModule.PrismaPg ?? adapterModule.default?.PrismaPg;
      if (!PrismaCtor || !PrismaPgCtor) {
        throw new Error("Prisma client 或 PostgreSQL adapter 不可用");
      }
      const adapter = new PrismaPgCtor({ connectionString: this.config.databaseUrl });
      this.client = new PrismaCtor({ adapter });
      this.logger.log("Analysis ledger 已启用 PostgreSQL canonical persistence。");
    } catch (error) {
      this.logger.error(
        `Analysis ledger 初始化失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }

  requireClient(): AnalysisPrismaClient {
    if (!this.client) {
      throw new DomainError(
        "ANALYSIS_CANONICAL_STORE_REQUIRED",
        "自治分析需要可用的 PostgreSQL canonical store。",
        503
      );
    }
    return this.client;
  }

  isReady(): boolean {
    return Boolean(this.client);
  }

  transaction<T>(
    operation: (transaction: AnalysisPrismaClient) => Promise<T>
  ): Promise<T> {
    return this.requireClient().$transaction(operation);
  }
}
