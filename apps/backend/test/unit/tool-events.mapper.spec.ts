import { ToolEventsMapper } from "../../src/modules/llm/tools/tool-events.mapper";

describe("ToolEventsMapper", () => {
  const mapper = new ToolEventsMapper();

  it("should map tool-call event to success trace step", () => {
    const step = mapper.toTraceStep({
      type: "tool-call",
      payload: {
        toolName: "runReadOnlySql",
        toolCallId: "tool-1",
        input: { sql: "SELECT 1" }
      }
    });
    expect(step).toMatchObject({
      node: "tool-call",
      status: "success"
    });
  });

  it("should map tool-error event to failed trace step", () => {
    const step = mapper.toTraceStep({
      type: "tool-error",
      payload: {
        toolName: "runReadOnlySql",
        toolCallId: "tool-2",
        message: "timeout"
      }
    });
    expect(step).toMatchObject({
      node: "tool-error",
      status: "failed"
    });
  });
});
