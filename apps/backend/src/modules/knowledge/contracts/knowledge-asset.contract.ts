import type {
  KnowledgeAssetKind,
  KnowledgeAssetV1
} from "@text2sql/shared-types";
import type {
  KnowledgeAssetFacade,
  KnowledgeAssetLookupInput
} from "../assets/knowledge-asset.facade";

export const KNOWLEDGE_ASSET_CONTRACT = Symbol("KNOWLEDGE_ASSET_CONTRACT");

export interface KnowledgeAssetContract {
  createCandidate: KnowledgeAssetFacade["createCandidate"];
  promote: KnowledgeAssetFacade["promote"];
  rollback: KnowledgeAssetFacade["rollback"];
  get: KnowledgeAssetFacade["get"];
  listActive: (input: KnowledgeAssetLookupInput) => Promise<KnowledgeAssetV1[]>;
  holdImpactedBySources: KnowledgeAssetFacade["holdImpactedBySources"];
  isReady: () => boolean;
}

export interface ActiveKnowledgeAssetProjection {
  kind: KnowledgeAssetKind;
  assets: KnowledgeAssetV1[];
}
