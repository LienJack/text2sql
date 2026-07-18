import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { AnalysisModule } from "../../src/modules/conversation/analysis/analysis.module";
import { AnalysisTaskCommandService } from "../../src/modules/conversation/analysis/application/analysis-task-command.service";
import { AnalysisOrchestratorService } from "../../src/modules/conversation/analysis/orchestration/analysis-orchestrator.service";
import { requestIdMiddleware } from "../../src/modules/middleware/request-id.middleware";
import { AnalysisLedgerPrismaService } from "../../src/modules/platform/data/persistence/analysis-ledger-prisma.service";
import { DurableWorkflowPort } from "../../src/modules/platform/durable/contracts/durable-workflow.port";

export type AnalysisApiTestContext = {
  app: INestApplication;
  ledger: AnalysisLedgerPrismaService;
  workspaceId: string;
  userId: string;
};

export const createAnalysisApiTestApp = async (
  durableOverride?: DurableWorkflowPort
): Promise<AnalysisApiTestContext> => {
  process.env.ANALYSIS_DURABLE_PROVIDER = "in_memory";
  const builder = Test.createTestingModule({ imports: [AnalysisModule] });
  builder.overrideProvider(AnalysisOrchestratorService).useValue({
    runAvailable: async () => ({ steps: 0, blocked: false })
  });
  if (durableOverride) {
    builder.overrideProvider(DurableWorkflowPort).useValue(durableOverride);
  }
  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication();
  app.use(requestIdMiddleware);
  app.use(testPrincipalMiddleware);
  await app.init();

  const ledger = app.get(AnalysisLedgerPrismaService);
  const suffix = uuidv4();
  const workspaceId = `analysis-api-${suffix}`;
  const userId = `analysis-user-${suffix}`;
  await ledger.requireClient().workspace.create({
    data: {
      id: workspaceId,
      name: workspaceId,
      status: "active",
      isDefault: false
    }
  });
  await ledger.requireClient().platformUser.create({
    data: {
      id: userId,
      account: userId,
      name: "Analysis Test User",
      email: `${userId}@example.test`,
      status: "active",
      isSystemAdmin: false
    }
  });
  await ledger.requireClient().workspaceMember.create({
    data: {
      id: uuidv4(),
      userId,
      workspaceId,
      role: "member"
    }
  });
  return { app, ledger, workspaceId, userId };
};

export const cleanupAnalysisApiTestApp = async (
  context: AnalysisApiTestContext
): Promise<void> => {
  await context.app.get(AnalysisTaskCommandService).dispatchPending();
  const client = context.ledger.requireClient();
  await client.analysisTask.deleteMany({ where: { workspaceId: context.workspaceId } });
  await client.workspaceMember.deleteMany({
    where: { workspaceId: context.workspaceId }
  });
  await client.platformUser.deleteMany({ where: { id: context.userId } });
  await client.workspace.deleteMany({ where: { id: context.workspaceId } });
  await context.app.close();
};

export const analysisRequestHeaders = (context: AnalysisApiTestContext) => ({
  "x-user-id": context.userId,
  "x-workspace-id": context.workspaceId
});

const testPrincipalMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const actorId = req.headers["x-user-id"]?.toString() ?? "missing-test-user";
  const workspaceId = req.headers["x-workspace-id"]?.toString();
  req.actor = {
    id: actorId,
    role: "user",
    requestedWorkspaceId: workspaceId,
    workspaceRoles: workspaceId ? { [workspaceId]: "member" } : {},
    principal: {
      authenticationMethod: "oidc_bearer",
      trustLevel: "verified",
      subject: actorId,
      actorId,
      requestedWorkspaceId: workspaceId,
      roleSet: ["workspace_member", "member"],
      authPolicyVersion: "analysis-e2e-auth-v1",
      digest: `principal:${actorId}`
    }
  };
  next();
};
