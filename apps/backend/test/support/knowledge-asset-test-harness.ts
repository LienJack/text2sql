import type { KnowledgeAssetV1 } from "@text2sql/shared-types";
import { KnowledgeAssetService } from "../../src/modules/knowledge/assets/knowledge-asset.service";

export async function createSkillCandidate(
  service: KnowledgeAssetService,
  workspaceId: string,
  suffix = "primary",
  sourceRefs = ["claim-1", "claim-2"]
): Promise<KnowledgeAssetV1> {
  return service.createCandidate({
    workspaceId,
    assetKind: "skill",
    assetKey: `revenue-analysis-${suffix}`,
    scope: { type: "workspace" },
    authority: { level: "workspace_admin", actorId: "governor-1" },
    content: {
      version: "knowledge-skill-binding.v1",
      domain: "semantic_term",
      term: "revenue",
      termAliases: ["收入"],
      contextKeywords: ["revenue", "收入"],
      skills: [{ key: "revenue_analysis", name: "收入分析" }]
    },
    sourceRefs,
    capabilityCeiling: ["artifact.read"],
    evaluation: {
      independentEvidenceRefs: sourceRefs,
      approvalDecisionRef: "decision-verified",
      requestedCapabilities: ["artifact.read"],
      invocationGrant: ["artifact.read"]
    },
    idempotencyKey: `skill-candidate-${suffix}`
  });
}

export async function promoteToActive(
  service: KnowledgeAssetService,
  initial: KnowledgeAssetV1,
  suffix = ""
): Promise<KnowledgeAssetV1> {
  const key = (value: string) => `${value}${suffix ? `-${suffix}` : ""}`;
  let asset = (
    await service.promote({
      assetId: initial.id,
      expectedStateVersion: initial.stateVersion,
      actorId: "governor-1",
      idempotencyKey: key("promote-verified"),
      evidence: {}
    })
  ).asset;
  asset = (
    await service.promote({
      assetId: asset.id,
      expectedStateVersion: asset.stateVersion,
      actorId: "governor-1",
      idempotencyKey: key("promote-shadow"),
      evidence: { regressionReceiptRefs: ["regression-1"] }
    })
  ).asset;
  asset = (
    await service.promote({
      assetId: asset.id,
      expectedStateVersion: asset.stateVersion,
      actorId: "governor-1",
      idempotencyKey: key("promote-canary"),
      evidence: {
        pairedEvaluationRefs: ["paired-1"],
        rollbackRef: "release:single-worker-v1"
      }
    })
  ).asset;
  return (
    await service.promote({
      assetId: asset.id,
      expectedStateVersion: asset.stateVersion,
      actorId: "governor-1",
      idempotencyKey: key("promote-active"),
      evidence: {
        canaryReceiptRefs: ["canary-1"],
        approvalDecisionRef: "decision-active",
        rollbackRef: "release:single-worker-v1"
      }
    })
  ).asset;
}
