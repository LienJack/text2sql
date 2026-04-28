import type { Text2SqlV2SmartDefaultsEvidenceV1 } from "@text2sql/shared-types";

export const TEXT2SQL_SMART_DEFAULTS_BUNDLE_ID = "text2sql-smart-defaults";
export const TEXT2SQL_SMART_DEFAULTS_VERSION = "2026-04-28";

export const TEXT2SQL_SMART_DEFAULTS_RULES = [
  {
    id: "only-use-context-pack",
    text: "Use only selected context pack, semantic plan, schema supplement, and explicit user constraints as grounding facts."
  },
  {
    id: "no-sql-for-direct-answer-routes",
    text: "For metadata, general, clarification, unsupported, or fail-closed routes, do not generate SQL."
  },
  {
    id: "fail-closed-read-only-governance",
    text: "Read-only, permission, governance, and policy failures are terminal unless deterministic validation marks them correctable."
  },
  {
    id: "correction-grounding-required",
    text: "Correction must use failed SQL, validation artifact, retry reason, semantic plan, and context pack evidence."
  },
  {
    id: "avoid-schema-hallucination",
    text: "Do not invent tables, columns, relationships, metrics, or filters absent from the semantic context."
  }
] as const;

export const TEXT2SQL_SMART_DEFAULTS_EVIDENCE: Text2SqlV2SmartDefaultsEvidenceV1 = {
  bundleId: TEXT2SQL_SMART_DEFAULTS_BUNDLE_ID,
  version: TEXT2SQL_SMART_DEFAULTS_VERSION,
  coveredStages: ["generate-sql", "correct", "answer"],
  ruleIds: TEXT2SQL_SMART_DEFAULTS_RULES.map((rule) => rule.id),
  status: "applied"
};
