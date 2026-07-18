import { resolveAnalysisTaskTransition } from "../../src/modules/conversation/analysis/application/analysis-task-state-machine";

describe("analysis task state machine", () => {
  it("freezes authority when pausing and cancelling", () => {
    expect(resolveAnalysisTaskTransition("running", "pause")).toEqual({
      nextStatus: "paused",
      incrementAuthorityEpoch: true,
      terminal: false
    });
    expect(resolveAnalysisTaskTransition("paused", "cancel")).toEqual({
      nextStatus: "cancelled",
      incrementAuthorityEpoch: true,
      terminal: true
    });
  });

  it("allows a terminal task to create a new revision but never restart directly", () => {
    expect(resolveAnalysisTaskTransition("completed", "revise").nextStatus).toBe(
      "draft"
    );
    expect(() => resolveAnalysisTaskTransition("completed", "start")).toThrow(
      expect.objectContaining({ code: "ANALYSIS_COMMAND_NOT_ALLOWED" })
    );
  });

  it("requires resume to originate from paused", () => {
    expect(resolveAnalysisTaskTransition("paused", "resume").nextStatus).toBe(
      "queued"
    );
    expect(() => resolveAnalysisTaskTransition("running", "resume")).toThrow(
      expect.objectContaining({ code: "ANALYSIS_COMMAND_NOT_ALLOWED" })
    );
  });
});
