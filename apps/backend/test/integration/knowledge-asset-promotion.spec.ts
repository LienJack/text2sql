import { KnowledgeAssetService } from "../../src/modules/knowledge/assets/knowledge-asset.service";
import { KnowledgeAssetFacade } from "../../src/modules/knowledge/assets/knowledge-asset.facade";
import { KnowledgeSkillBindingSource } from "../../src/modules/knowledge/assets/knowledge-skill-binding-source.service";
import { KnowledgePromotionPolicy } from "../../src/modules/knowledge/assets/knowledge-promotion-policy";
import { SkillRegistryService } from "../../src/modules/skill-registry/skill-registry.service";
import {
  createAnalysisLedgerTestHarness,
  type AnalysisLedgerTestHarness
} from "../support/analysis-ledger-test-harness";
import {
  createSkillCandidate,
  promoteToActive
} from "../support/knowledge-asset-test-harness";

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase("KnowledgeAsset governed promotion", () => {
  let harness: AnalysisLedgerTestHarness;
  let service: KnowledgeAssetService;

  beforeEach(async () => {
    harness = await createAnalysisLedgerTestHarness();
    service = new KnowledgeAssetService(
      harness.prisma,
      new KnowledgePromotionPolicy()
    );
  });

  afterEach(async () => {
    await harness.close();
  });

  it("keeps single-run learning candidate-only and resolves active skills from PostgreSQL", async () => {
    const singleRun = await service.createCandidate({
      workspaceId: harness.workspaceId,
      assetKind: "memory",
      assetKey: "single-run-memory",
      scope: { type: "workspace" },
      authority: { level: "workspace_member", actorId: "analyst-1" },
      content: { version: "knowledge-memory.v1", fact: "single observation" },
      sourceRefs: ["run-1"],
      idempotencyKey: "single-run-memory"
    });
    expect(singleRun.status).toBe("candidate");
    expect(
      await service.listActive({
        workspaceId: harness.workspaceId,
        assetKind: "memory"
      })
    ).toEqual([]);

    const candidate = await createSkillCandidate(service, harness.workspaceId);
    const active = await promoteToActive(service, candidate);
    expect(active.status).toBe("active");

    expect(
      await service.listActive({
        workspaceId: harness.workspaceId,
        assetKind: "skill"
      })
    ).toEqual([]);
    const visible = await service.listActive({
      workspaceId: harness.workspaceId,
      assetKind: "skill",
      capabilityGrant: ["artifact.read"]
    });
    expect(visible.map((asset) => asset.id)).toEqual([active.id]);
    expect(
      await service.listActive({
        workspaceId: "another-workspace",
        assetKind: "skill",
        capabilityGrant: ["artifact.read"]
      })
    ).toEqual([]);

    const restarted = new KnowledgeAssetService(
      harness.prisma,
      new KnowledgePromotionPolicy()
    );
    const afterRestart = await restarted.listActive({
      workspaceId: harness.workspaceId,
      assetKind: "skill",
      capabilityGrant: ["artifact.read"]
    });
    expect(afterRestart.map((asset) => asset.id)).toEqual([active.id]);
    const registry = new SkillRegistryService(
      new KnowledgeSkillBindingSource(new KnowledgeAssetFacade(restarted))
    );
    expect(
      await registry.resolveSkills({
        workspaceId: harness.workspaceId,
        domain: "semantic_term",
        term: "收入",
        capabilityGrant: ["artifact.read"]
      })
    ).toEqual(
      expect.objectContaining({
        skills: [{ key: "revenue_analysis", name: "收入分析" }]
      })
    );
    expect(
      await registry.resolveSkills({
        workspaceId: harness.workspaceId,
        domain: "semantic_term",
        term: "收入",
        capabilityGrant: []
      })
    ).toEqual({ skills: [], context: [] });
  });

  it("makes duplicate promotion transitions idempotent", async () => {
    const candidate = await createSkillCandidate(service, harness.workspaceId);
    const input = {
      assetId: candidate.id,
      expectedStateVersion: candidate.stateVersion,
      actorId: "governor-1",
      idempotencyKey: "promote-verified",
      evidence: {}
    };
    const first = await service.promote(input);
    const duplicate = await service.promote(input);

    expect(first.asset.status).toBe("verified");
    expect(duplicate.asset.status).toBe("verified");
    const transitions = await harness.prisma
      .requireClient()
      .knowledgeAssetTransition.findMany({ where: { assetId: candidate.id } });
    expect(transitions).toHaveLength(2);
  });
});
