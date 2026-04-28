export const TEXT2SQL_STAGE_NAMES = [
  "prepare-run",
  "plan-intent",
  "retrieve-context",
  "generate-sql",
  "validate-sql",
  "execute-sql",
  "format-answer",
  "persist-run",
  "post-run-hooks",
  "generic"
] as const;

export type Text2SqlStageName = (typeof TEXT2SQL_STAGE_NAMES)[number];

export const TEXT2SQL_STAGE_OUTCOMES = [
  "success",
  "skipped",
  "degraded",
  "failed",
  "needs-clarification"
] as const;

export type Text2SqlStageOutcome = (typeof TEXT2SQL_STAGE_OUTCOMES)[number];
