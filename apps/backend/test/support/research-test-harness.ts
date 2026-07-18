import { AppConfigService } from "../../src/modules/config/app-config.service";
import { AnalysisTaskService } from "../../src/modules/conversation/analysis/application/analysis-task.service";
import type { ResearchSourcePolicyRecord } from "../../src/modules/knowledge/research/contracts/research.types";
import { ResearchSourceSnapshotService } from "../../src/modules/knowledge/research/source-snapshot.service";
import { ResearchSourcePolicyService } from "../../src/modules/knowledge/research/source-policy/research-source-policy.service";
import { GovernanceAnalysisAccessFacade } from "../../src/modules/governance/access/governance-analysis-access.facade";
import { AnalysisTaskRepository } from "../../src/modules/platform/data/persistence/analysis-task.repository";
import {
  buildGoalContract,
  createAnalysisLedgerTestHarness,
  type AnalysisLedgerTestHarness
} from "./analysis-ledger-test-harness";

export const researchActor = {
  id: "research-analyst",
  role: "user" as const,
  principal: {
    authenticationMethod: "oidc_bearer" as const,
    trustLevel: "verified" as const,
    subject: "research-analyst",
    actorId: "research-analyst",
    roleSet: ["workspace_member" as const],
    authPolicyVersion: "auth-v1",
    digest: "research-principal-v1"
  }
};

export type ResearchTestHarness = {
  ledger: AnalysisLedgerTestHarness;
  taskId: string;
  revisionId: string;
  policy: ResearchSourcePolicyRecord;
  sourcePolicy: ResearchSourcePolicyService;
  snapshots: ResearchSourceSnapshotService;
  config: AppConfigService;
  close: () => Promise<void>;
};

export async function createResearchTestHarness(): Promise<ResearchTestHarness> {
  const ledger = await createAnalysisLedgerTestHarness();
  const config = {
    analysisResearchEnabled: true,
    analysisResearchProvider: "tavily",
    tavilyApiKey: "tvly-test-secret",
    tavilyApiBaseUrl: "",
    analysisResearchAllowedDomains: [],
    analysisResearchMaxContentBytes: 16 * 1024,
    analysisResearchDefaultRetentionDays: 30,
    analysisTaskArtifactMaxBytes: 512 * 1024,
    analysisResearchSearchTimeoutMs: 10_000,
    analysisResearchExtractTimeoutMs: 20_000
  } as unknown as AppConfigService;
  const tasks = new AnalysisTaskRepository(ledger.prisma);
  const taskService = new AnalysisTaskService(
    tasks,
    {
      assertWorkspaceRead: jest.fn().mockResolvedValue(undefined)
    } as unknown as GovernanceAnalysisAccessFacade
  );
  const created = await taskService.create({
    actor: researchActor,
    goalContract: buildGoalContract(ledger.workspaceId),
    idempotencyKey: "research-test-task"
  });
  const sourcePolicy = new ResearchSourcePolicyService(ledger.prisma, config);
  const connector = await sourcePolicy.configureConnector({
    workspaceId: ledger.workspaceId,
    actorId: researchActor.id
  });
  const policy = await sourcePolicy.createPolicy({
    workspaceId: ledger.workspaceId,
    actorId: researchActor.id,
    connectorConfigId: connector.id,
    allowedDomains: ["one.example.com", "two.example.org"],
    allowedQueryParams: ["lang"],
    maxContentBytes: 16 * 1024,
    retentionDays: 30,
    minIndependentSources: 2,
    requireCounterEvidence: true
  });
  return {
    ledger,
    taskId: created.task.id,
    revisionId: created.currentRevision.id,
    policy,
    sourcePolicy,
    snapshots: new ResearchSourceSnapshotService(ledger.prisma, sourcePolicy),
    config,
    close: ledger.close
  };
}
