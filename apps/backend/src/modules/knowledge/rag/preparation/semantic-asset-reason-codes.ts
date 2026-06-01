export const SEMANTIC_ASSET_REASON_CODES = {
  prepared: "prepared",
  semanticAssetReindexRequested: "semantic_asset_reindex_requested",
  skippedNoTriggers: "skipped_no_triggers",
  skippedDisabled: "skipped_disabled",
  skippedAlreadyActive: "skip:already_active",
  degradedInvalidSourceSnapshot: "degraded_invalid_source_snapshot",
  degradedMissingSourceHash: "degraded_missing_source_hash",
  degradedMissingRelationshipPayload: "degraded_missing_relationship_payload",
  degradedMissingModelingRevision: "degraded_missing_modeling_revision",
  skippedCorrectionNotPromoted: "skipped_correction_not_promoted",
  staleSourceVersion: "stale_source_version",
  activationReplacedPrevious: "activation_replaced_previous"
} as const;

export type SemanticAssetReasonCode =
  (typeof SEMANTIC_ASSET_REASON_CODES)[keyof typeof SEMANTIC_ASSET_REASON_CODES] |
  `trigger:${string}` |
  string;
