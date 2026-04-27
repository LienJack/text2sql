import { Text2SqlStreamEventMapper } from "../../src/modules/conversation/text2sql/stream/text2sql-stream-event.mapper";

describe("Text2SqlStreamEventMapper", () => {
  const mapper = new Text2SqlStreamEventMapper();

  it("maps unknown step nodes safely with fallback stage/title", () => {
    const mapped = mapper.mapStepEvent({
      step: {
        node: "future-node",
        status: "success",
        at: "2026-04-26T00:00:00.000Z"
      },
      runId: "run-1",
      lastSequence: 0
    });

    expect(mapped.data).toMatchObject({
      node: "future-node",
      stage: "unknown",
      title: "future-node",
      sequence: 1
    });
  });

  it("maps optional v2 stage artifact from step summary without breaking shell fields", () => {
    const mapped = mapper.mapStepEvent({
      step: {
        node: "generate-sql",
        status: "success",
        at: "2026-04-26T00:00:00.000Z",
        outputSummary: JSON.stringify({
          v2: {
            stageArtifact: {
              stage: "generate-sql",
              status: "success",
              durationMs: 12
            }
          }
        })
      },
      runId: "run-2",
      lastSequence: 0
    });

    const data = mapped.data as {
      node: string;
      status: string;
      v2?: {
        stageArtifact?: {
          stage?: string;
          status?: string;
          durationMs?: number;
        };
      };
    };
    expect(data.node).toBe("generate-sql");
    expect(data.status).toBe("success");
    expect(data.v2?.stageArtifact).toEqual({
      stage: "generate-sql",
      status: "success",
      durationMs: 12
    });
  });

  it("maps tool-call/result/error events with trace payload", () => {
    const called = mapper.mapLlmEvent({
      type: "tool-call",
      toolName: "runReadOnlySql",
      toolCallId: "call-1",
      input: { sql: "SELECT 1" }
    });
    expect(called.type).toBe("tool-call");
    expect(called.traceToolCall?.status).toBe("called");

    const result = mapper.mapLlmEvent({
      type: "tool-result",
      toolName: "runReadOnlySql",
      toolCallId: "call-1",
      output: { rows: [] }
    });
    expect(result.type).toBe("tool-result");
    expect(result.traceToolCall?.status).toBe("result");

    const error = mapper.mapLlmEvent({
      type: "tool-error",
      toolName: "runReadOnlySql",
      toolCallId: "call-1",
      message: "failed"
    });
    expect(error.type).toBe("tool-error");
    expect(error.traceToolCall?.status).toBe("error");
  });

  it("builds stream envelope with required fields", () => {
    const envelope = mapper.createEnvelope({
      type: "start",
      data: {
        requestId: "req-1"
      },
      runId: "run-1",
      sessionId: "session-1",
      at: "2026-04-26T00:00:00.000Z"
    });

    expect(envelope).toEqual({
      type: "start",
      runId: "run-1",
      sessionId: "session-1",
      at: "2026-04-26T00:00:00.000Z",
      data: {
        requestId: "req-1"
      }
    });
  });

  it("keeps stream shell fields stable when state data carries v2 progress", () => {
    const mapped = mapper.mapStepEvent({
      step: {
        node: "safety-check",
        status: "success",
        at: "2026-04-26T00:00:01.000Z",
        outputSummary: JSON.stringify({
          v2: {
            stageArtifact: {
              stage: "validate",
              status: "success",
              warnings: ["validation_passed"]
            }
          }
        })
      },
      runId: "run-v2-shell",
      lastSequence: 2
    });
    const envelope = mapper.createEnvelope({
      type: "state",
      runId: "run-v2-shell",
      sessionId: "session-v2-shell",
      at: "2026-04-26T00:00:01.000Z",
      data: mapped.data
    });

    expect(envelope).toMatchObject({
      type: "state",
      runId: "run-v2-shell",
      sessionId: "session-v2-shell",
      at: "2026-04-26T00:00:01.000Z"
    });
    const data = envelope.data as {
      v2?: {
        stageArtifact?: {
          stage?: string;
        };
      };
    };
    expect(data.v2?.stageArtifact?.stage).toBe("validate");
  });

  it.each([
    {
      node: "retrieve-knowledge",
      artifact: {
        stage: "retrieve",
        status: "degraded",
        warnings: ["dense_unavailable"],
        provider: {
          provider: "embedding-provider",
          unavailableReason: "provider_missing"
        }
      }
    },
    {
      node: "safety-check",
      artifact: {
        stage: "validate",
        status: "success",
        warnings: ["dry-run skipped: datasource type unknown"]
      }
    },
    {
      node: "relationship-correction",
      artifact: {
        stage: "correct",
        status: "success",
        metadata: {
          retryCount: 1,
          maxAttempts: 2
        }
      }
    },
    {
      node: "generate-sql",
      artifact: {
        stage: "generate-sql",
        status: "success",
        metadata: {
          sql: "SELECT COUNT(*) AS total FROM orders"
        }
      }
    },
    {
      node: "format-answer",
      artifact: {
        stage: "answer",
        status: "success",
        metadata: {
          answerPreview: "订单总数为 10"
        }
      }
    }
  ])("maps $artifact.stage progress with v2 artifact and stable shell", ({ node, artifact }) => {
    const mapped = mapper.mapStepEvent({
      step: {
        node,
        status: artifact.status === "degraded" ? "success" : "success",
        at: "2026-04-26T00:00:01.000Z",
        outputSummary: JSON.stringify({
          v2: {
            stageArtifact: artifact
          }
        })
      },
      runId: "run-v2-progress",
      lastSequence: 7
    });
    const envelope = mapper.createEnvelope({
      type: "state",
      runId: "run-v2-progress",
      sessionId: "session-v2-progress",
      at: "2026-04-26T00:00:01.000Z",
      data: mapped.data
    });

    expect(envelope).toMatchObject({
      type: "state",
      runId: "run-v2-progress",
      sessionId: "session-v2-progress",
      at: "2026-04-26T00:00:01.000Z",
      data: {
        node,
        sequence: 8,
        v2: {
          stageArtifact: artifact
        }
      }
    });
  });
});
