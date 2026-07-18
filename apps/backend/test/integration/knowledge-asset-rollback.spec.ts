import { KnowledgeAssetService } from "../../src/modules/knowledge/assets/knowledge-asset.service";
import { KnowledgePromotionPolicy } from "../../src/modules/knowledge/assets/knowledge-promotion-policy";
import {
  createAnalysisLedgerTestHarness,
  type AnalysisLedgerTestHarness
} from "../support/analysis-ledger-test-harness";
import {
  createSkillCandidate,
  promoteToActive
} from "../support/knowledge-asset-test-harness";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("KnowledgeAsset governed rollback", () => {
  let harness: AnalysisLedgerTestHarness;

  beforeEach(async () => {
    harness = await createAnalysisLedgerTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("rolls active skill back exactly once and removes it from active projection", async () => {
    const service = new KnowledgeAssetService(
      harness.prisma,
      new KnowledgePromotionPolicy()
    );
    const candidate = await createSkillCandidate(
      service,
      harness.workspaceId,
      "rollback"
    );
    const active = await promoteToActive(service, candidate);
    const input = {
      assetId: active.id,
      expectedStateVersion: active.stateVersion,
      actorId: "governor-1",
      decisionRef: "decision-rollback",
      idempotencyKey: "rollback-active",
      reasonCodes: ["canary_regression_detected"]
    };
    const rolledBack = await service.rollback(input);
    const duplicate = await service.rollback(input);

    expect(rolledBack.status).toBe("rolled_back");
    expect(duplicate.status).toBe("rolled_back");
    expect(
      await service.listActive({
        workspaceId: harness.workspaceId,
        assetKind: "skill",
        capabilityGrant: ["artifact.read"]
      })
    ).toEqual([]);
    const transitions = await harness.prisma
      .requireClient()
      .knowledgeAssetTransition.findMany({ where: { assetId: active.id } });
    expect(transitions).toHaveLength(6);
  });
});
