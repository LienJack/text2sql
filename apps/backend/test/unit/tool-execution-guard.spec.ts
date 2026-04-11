import { ToolExecutionGuard } from "../../src/modules/llm/tools/tool-execution-guard";

describe("ToolExecutionGuard", () => {
  const guard = new ToolExecutionGuard();

  it("should allow read-only select sql", () => {
    expect(() =>
      guard.assertReadOnlySql("SELECT status, COUNT(*) FROM orders GROUP BY status")
    ).not.toThrow();
  });

  it("should reject write sql", () => {
    expect(() => guard.assertReadOnlySql("DELETE FROM orders")).toThrow(
      expect.objectContaining({
        code: "TOOL_INPUT_INVALID"
      })
    );
  });
});
