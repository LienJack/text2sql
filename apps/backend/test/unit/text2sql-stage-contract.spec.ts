import { Test } from "@nestjs/testing";
import { Text2SqlModule } from "../../src/modules/conversation/text2sql/text2sql.module";
import {
  TEXT2SQL_LANGGRAPH_NODE_STAGE_MAP,
  resolveText2SqlNodeStageCatalogEntry,
  resolveText2SqlReasoningStage,
  resolveText2SqlStageName,
  resolveText2SqlTitle
} from "../../src/modules/conversation/text2sql/stages/text2sql-stage-catalog";
import { TEXT2SQL_STAGE_OUTCOMES } from "../../src/modules/conversation/text2sql/contracts/text2sql-stage-name";

const CURRENT_LANGGRAPH_NODE_NAMES = [
  "clarify",
  "retrieve-knowledge",
  "build-intent-plan",
  "build-semantic-query",
  "build-physical-plan",
  "resolve-saved-prior-sql",
  "generate-sql",
  "safety-check",
  "execute-sql",
  "relationship-correction",
  "format-answer"
] as const;

describe("text2sql stage contracts", () => {
  it("maps every current LangGraph node name to exactly one product stage", () => {
    expect(Object.keys(TEXT2SQL_LANGGRAPH_NODE_STAGE_MAP).sort()).toEqual(
      [...CURRENT_LANGGRAPH_NODE_NAMES].sort()
    );

    for (const node of CURRENT_LANGGRAPH_NODE_NAMES) {
      const entry = resolveText2SqlNodeStageCatalogEntry(node);
      expect(entry.stageName).not.toBe("generic");
      expect(entry.stageTitle).toBeTruthy();
    }
  });

  it("maps unknown node names to a safe generic stage without throwing", () => {
    expect(() => resolveText2SqlNodeStageCatalogEntry("future-node")).not.toThrow();

    const entry = resolveText2SqlNodeStageCatalogEntry("future-node");
    expect(entry.stageName).toBe("generic");
    expect(entry.reasoningStage).toBe("unknown");
    expect(entry.title).toBe("future-node");
    expect(resolveText2SqlStageName("future-node")).toBe("generic");
  });

  it("keeps reasoning stage/title compatibility with current stream state conventions", () => {
    expect(resolveText2SqlReasoningStage("clarify")).toBe("analysis");
    expect(resolveText2SqlTitle("clarify")).toBe("理解问题");
    expect(resolveText2SqlReasoningStage("generate-sql")).toBe("generation");
    expect(resolveText2SqlTitle("format-answer")).toBe("整理回答");

    expect(resolveText2SqlReasoningStage("relationship-correction")).toBe("unknown");
    expect(resolveText2SqlTitle("relationship-correction")).toBe(
      "relationship-correction"
    );
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

  it("imports Text2SqlModule without requiring heavy cross-domain providers", async () => {
    const testingModule = await Test.createTestingModule({
      imports: [Text2SqlModule]
    }).compile();

    expect(testingModule.get(Text2SqlModule)).toBeDefined();
  });
});
