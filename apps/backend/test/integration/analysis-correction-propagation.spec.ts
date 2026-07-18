import { AnalysisTaskService } from "../../src/modules/conversation/analysis/application/analysis-task.service";
import { CorrectionCommandService } from "../../src/modules/conversation/analysis/correction/correction-command.service";
import { CorrectionImpactService } from "../../src/modules/conversation/analysis/correction/correction-impact.service";
import { KnowledgeAssetFacade } from "../../src/modules/knowledge/assets/knowledge-asset.facade";
import { KnowledgeAssetService } from "../../src/modules/knowledge/assets/knowledge-asset.service";
import { KnowledgePromotionPolicy } from "../../src/modules/knowledge/assets/knowledge-promotion-policy";
import { PostgresArtifactPayloadStoreService } from "../../src/modules/platform/artifacts/postgres-artifact-payload-store.service";
import { AnalysisArtifactRepository } from "../../src/modules/platform/data/persistence/analysis-artifact.repository";
import { AnalysisTaskRepository } from "../../src/modules/platform/data/persistence/analysis-task.repository";
import {
  buildGoalContract,
  createAnalysisLedgerTestHarness,
  type AnalysisLedgerTestHarness
} from "../support/analysis-ledger-test-harness";
import {
  createSkillCandidate,
  promoteToActive
} from "../support/knowledge-asset-test-harness";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("Analysis correction propagation", () => {
  let harness: AnalysisLedgerTestHarness;

  const actor = {
    id: "analyst-1",
    role: "user" as const,
    principal: {
      authenticationMethod: "oidc_bearer" as const,
      trustLevel: "verified" as const,
      subject: "analyst-1",
      actorId: "analyst-1",
      roleSet: ["workspace_member" as const],
      authPolicyVersion: "auth-v1",
      digest: "principal-v1"
    }
  };

  beforeEach(async () => {
    harness = await createAnalysisLedgerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("invalidates downstream SQL/Claim/Report and holds Memory/Skill without deleting replay", async () => {
    const tasks = new AnalysisTaskRepository(harness.prisma);
    const taskService = new AnalysisTaskService(
      tasks,
      { assertWorkspaceRead: jest.fn().mockResolvedValue(undefined) } as never
    );
    const created = await taskService.create({
      actor,
      goalContract: buildGoalContract(harness.workspaceId),
      idempotencyKey: "correction-propagation"
    });
    const attempt = await tasks.createAttempt({
      taskId: created.task.id,
      revisionId: created.currentRevision.id,
      idempotencyKey: "correction-attempt"
    });
    const queued = await tasks.transitionTask({
      taskId: created.task.id,
      expectedTaskVersion: created.task.version,
      expectedAuthorityEpoch: created.task.authorityEpoch,
      nextStatus: "queued",
      eventType: "command.accepted",
      idempotencyKey: "correction-start"
    });
    const running = await tasks.transitionTask({
      taskId: created.task.id,
      expectedTaskVersion: queued.task.version,
      expectedAuthorityEpoch: queued.task.authorityEpoch,
      nextStatus: "running",
      eventType: "orchestrator.started",
      idempotencyKey: "correction-running"
    });
    const artifacts = new AnalysisArtifactRepository(
      harness.prisma,
      new PostgresArtifactPayloadStoreService(harness.config, harness.prisma),
      harness.config
    );
    const commit = (input: {
      id: string;
      type: string;
      links?: string[];
      payload?: Record<string, unknown>;
    }) =>
      artifacts.commitArtifact({
        artifactId: input.id,
        taskId: created.task.id,
        revisionId: created.currentRevision.id,
        attemptId: attempt.id,
        authorityEpoch: running.task.authorityEpoch,
        artifactType: input.type,
        schemaVersion: `${input.type}.v1`,
        classification: "workspace",
        visibility: "user",
        completeness: "complete",
        links: (input.links ?? []).map((targetArtifactId) => ({
          targetArtifactId,
          relationType: "derived_from" as const
        })),
        payload: input.payload ?? { id: input.id }
      });
    const metric = await commit({
      id: "metric-definition",
      type: "analysis.metric_definition"
    });
    const sql = await commit({
      id: "sql-evidence",
      type: "analysis.sql_evidence",
      links: [metric.id]
    });
    const evidence = await commit({
      id: "normalized-evidence",
      type: "analysis.evidence",
      links: [sql.id]
    });
    const calculation = await commit({
      id: "calculation",
      type: "analysis.calculation",
      links: [evidence.id]
    });
    const claim = await commit({
      id: "claim",
      type: "analysis.claim",
      links: [calculation.id, evidence.id]
    });
    const report = await commit({
      id: "report",
      type: "analysis.report",
      links: [claim.id],
      payload: { version: "analysis-report.v1", summary: "old truth" }
    });
    const oldManifest = await artifacts.sealManifest({
      manifestId: "report-manifest",
      taskId: created.task.id,
      revisionId: created.currentRevision.id,
      attemptId: attempt.id,
      authorityEpoch: running.task.authorityEpoch,
      manifestType: "analysis.report",
      schemaVersion: "analysis-report-manifest.v1",
      status: "HOLD",
      artifactRefs: [report.id],
      receiptRefs: [],
      limitations: []
    });

    const assetService = new KnowledgeAssetService(
      harness.prisma,
      new KnowledgePromotionPolicy()
    );
    const activeSkill = await promoteToActive(
      assetService,
      await createSkillCandidate(
        assetService,
        harness.workspaceId,
        "correction",
        [claim.id, report.id]
      ),
      "correction"
    );
    const memoryCandidate = await assetService.createCandidate({
      workspaceId: harness.workspaceId,
      assetKind: "memory",
      assetKey: "metric-memory",
      scope: { type: "workspace" },
      authority: { level: "workspace_member", actorId: actor.id },
      content: { version: "knowledge-memory.v1", metric: "old-revenue" },
      sourceRefs: [metric.id, report.id],
      idempotencyKey: "metric-memory"
    });
    const facade = new KnowledgeAssetFacade(assetService);
    const impactService = new CorrectionImpactService(
      harness.prisma,
      tasks,
      facade
    );
    const command = new CorrectionCommandService(
      taskService,
      artifacts,
      impactService,
      tasks
    );

    const correctionInput = {
      actor,
      taskId: created.task.id,
      targetArtifactRefs: [metric.id],
      errorClass: "metric_definition" as const,
      scope: "Q2 revenue metric",
      effectiveAt: "2026-07-17T00:00:00.000Z",
      reason: "收入定义应排除取消订单。",
      decisionRef: "decision-metric-correction",
      idempotencyKey: "metric-correction"
    };
    const result = await command.correct(correctionInput);
    const duplicate = await command.correct(correctionInput);

    expect(result.impact.impactedArtifactRefs).toEqual(
      expect.arrayContaining([
        metric.id,
        sql.id,
        evidence.id,
        calculation.id,
        claim.id,
        report.id
      ])
    );
    expect(result.impact.invalidatedArtifactRefs).toEqual([metric.id]);
    expect(result.impact.impactedKnowledgeAssetRefs).toEqual(
      expect.arrayContaining([activeSkill.id, memoryCandidate.id])
    );
    expect((await assetService.get(activeSkill.id))?.status).toBe("held");
    expect((await assetService.get(memoryCandidate.id))?.status).toBe(
      "tombstoned"
    );
    expect(
      await assetService.listActive({
        workspaceId: harness.workspaceId,
        assetKind: "skill",
        capabilityGrant: ["artifact.read"]
      })
    ).toEqual([]);

    const replay = await artifacts.readCommittedPayload(created.task.id, report.id);
    expect(replay.payload).toEqual(
      expect.objectContaining({ summary: "old truth" })
    );
    const readModel = await tasks.getReadModel(created.task.id);
    expect(
      readModel.artifacts.find((artifact) => artifact.id === metric.id)?.invalidatedAt
    ).toBeDefined();
    expect(
      readModel.artifacts.find((artifact) => artifact.id === report.id)?.staleAt
    ).toBeDefined();
    expect(
      readModel.manifests.find((manifest) => manifest.id === oldManifest.id)?.staleAt
    ).toBeDefined();
    expect(
      readModel.events.some((event) => event.type === "correction.impact.applied")
    ).toBe(true);
    expect(
      readModel.manifests.find((manifest) => manifest.id === result.manifestId)
        ?.status
    ).toBe("HOLD");
    expect(readModel.currentRevision.id).toBe(result.recomputeRevisionId);
    expect(readModel.currentRevision.revision).toBe(2);
    expect(duplicate).toEqual(result);
    expect(
      readModel.attempts.some(
        (item) =>
          item.id === result.recomputeAttemptId &&
          item.revisionId === result.recomputeRevisionId
      )
    ).toBe(true);
  });
});
