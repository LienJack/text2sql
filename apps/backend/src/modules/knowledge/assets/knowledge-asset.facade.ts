import { Injectable } from "@nestjs/common";
import type {
  KnowledgeAssetKind,
  KnowledgeAssetScopeType
} from "@text2sql/shared-types";
import type { KnowledgePromotionEvidenceInput } from "./knowledge-promotion-policy";
import { KnowledgeAssetService } from "./knowledge-asset.service";

export interface KnowledgeAssetLookupInput {
  workspaceId: string;
  assetKind?: KnowledgeAssetKind;
  capabilityGrant?: string[];
  at?: string;
}

@Injectable()
export class KnowledgeAssetFacade {
  constructor(private readonly assets: KnowledgeAssetService) {}

  isReady(): boolean {
    return this.assets.isReady();
  }

  createCandidate(input: {
    workspaceId: string;
    assetKind: KnowledgeAssetKind;
    assetKey: string;
    scope: { type: KnowledgeAssetScopeType; ref?: string };
    authority: { level: string; actorId: string };
    content: Record<string, unknown>;
    sourceRefs: string[];
    capabilityCeiling?: string[];
    evaluation?: KnowledgePromotionEvidenceInput;
    idempotencyKey: string;
    validFrom?: string;
    validTo?: string;
  }) {
    return this.assets.createCandidate(input);
  }

  promote(input: Parameters<KnowledgeAssetService["promote"]>[0]) {
    return this.assets.promote(input);
  }

  rollback(input: Parameters<KnowledgeAssetService["rollback"]>[0]) {
    return this.assets.rollback(input);
  }

  get(assetId: string) {
    return this.assets.get(assetId);
  }

  listActive(input: KnowledgeAssetLookupInput) {
    return this.assets.listActive(input);
  }

  holdImpactedBySources(
    input: Parameters<KnowledgeAssetService["holdImpactedBySources"]>[0]
  ) {
    return this.assets.holdImpactedBySources(input);
  }
}
