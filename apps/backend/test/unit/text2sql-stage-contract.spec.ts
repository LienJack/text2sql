import { TEXT2SQL_STAGE_OUTCOMES } from "../../src/modules/conversation/text2sql/contracts/text2sql-stage-name";
import {
  TEXT2SQL_V2_STAGE_CATALOG,
  resolveText2SqlReasoningStage,
  resolveText2SqlTitle,
  resolveText2SqlV2StageCatalogEntry
} from "../../src/modules/conversation/text2sql/stages/text2sql-stage-catalog";

describe("text2sql stage contracts", () => {
  it("keeps a complete v2 stage catalog for stage-owned runtime progress", () => {
    expect(Object.keys(TEXT2SQL_V2_STAGE_CATALOG).sort()).toEqual(
      [
        "answer",
        "assemble-context",
        "correct",
        "execute",
        "generate-sql",
        "intake",
        "retrieve",
        "semantic-plan",
        "validate"
      ].sort()
    );

    const semanticPlan = resolveText2SqlV2StageCatalogEntry("semantic-plan");
    expect(semanticPlan.title).toBe("语义规划");
    expect(semanticPlan.reasoningStage).toBe("analysis");
    expect(semanticPlan.taskProfile).toBe("semantic-planning");
    expect(semanticPlan.defaultReasoningTier).toBe("high");
  });

  it("keeps node-level stage/title compatibility for shell fields", () => {
    expect(resolveText2SqlReasoningStage("clarify")).toBe("analysis");
    expect(resolveText2SqlTitle("clarify")).toBe("理解问题");
    expect(resolveText2SqlReasoningStage("generate-sql")).toBe("generation");
    expect(resolveText2SqlTitle("format-answer")).toBe("整理回答");

    expect(resolveText2SqlReasoningStage("future-node")).toBe("unknown");
    expect(resolveText2SqlTitle("future-node")).toBe("future-node");
  });

  it("includes the required stage outcome vocabulary", () => {
    expect(TEXT2SQL_STAGE_OUTCOMES).toEqual(
      expect.arrayContaining([
        "success",
        "skipped",
        "degraded",
        "failed",
        "needs-clarification"
      ])
    );
  });
});
