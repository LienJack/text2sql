import {
  MAX_RELATIONSHIP_CORRECTION_RETRY,
  shouldRetryRelationshipCorrection
} from "../../src/modules/conversation/agent/graph/langgraph.state";

describe("agent relationship correction loop", () => {
  it("retries only when relationship-path errors are detected within retry budget", () => {
    expect(
      shouldRetryRelationshipCorrection({
        error: "missing_relation_path: cannot resolve join path",
        retryCount: 0
      })
    ).toBe(true);
    expect(
      shouldRetryRelationshipCorrection({
        error: "join_key_mismatch on relationship binding",
        retryCount: 1
      })
    ).toBe(true);
  });

  it("stops retrying after MAX_RELATIONSHIP_CORRECTION_RETRY", () => {
    expect(MAX_RELATIONSHIP_CORRECTION_RETRY).toBe(2);
    expect(
      shouldRetryRelationshipCorrection({
        error: "ambiguous_join_path",
        retryCount: 2
      })
    ).toBe(false);
  });

  it("does not retry for non-relationship execution errors", () => {
    expect(
      shouldRetryRelationshipCorrection({
        error: "SQL syntax error near SELECT",
        retryCount: 0
      })
    ).toBe(false);
  });
});
