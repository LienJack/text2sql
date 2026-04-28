import { ChatDeliveryEnrichmentService } from "../../src/modules/conversation/chat/application/shared/chat-delivery-enrichment.service";
import type { SqlRun } from "@text2sql/shared-types";

describe("ChatDeliveryEnrichmentService", () => {
  it("builds delivery evidence v2 mirror with runtime intelligence fields from trace", () => {
    const service = new ChatDeliveryEnrichmentService(
      {} as never,
      {} as never,
      {} as never
    );
    const run: SqlRun = {
      runId: "run-enrichment",
      sessionId: "session-enrichment",
      question: "统计订单",
      status: "executionResult",
      provider: "volcengine",
      answer: "ok",
      trace: {
        runId: "run-enrichment",
        provider: "volcengine",
        retryCount: 0,
        steps: [],
        v2: {
          version: "v2",
          stageOrder: ["intake", "answer"],
          stages: [
            {
              stage: "intake",
              status: "success"
            },
            {
              stage: "answer",
              status: "success"
            }
          ],
          runtimePlan: {
            version: "runtime-plan.v1",
            items: [
              {
                id: "runtime-plan:intake",
                stage: "intake",
                goal: "理解问题",
                status: "completed"
              }
            ]
          },
          artifactRefs: [
            {
              id: "artifact:context_snippets:abc",
              category: "context_snippets",
              summary: "Compacted context",
              hash: "sha256:abc",
              visibility: "user"
            }
          ],
          smartDefaults: {
            bundleId: "text2sql-smart-defaults",
            version: "2026-04-28",
            coveredStages: ["generate-sql"],
            ruleIds: ["only-use-context-pack"],
            status: "applied"
          }
        }
      },
      delivery: {
        answer: {
          text: "ok",
          status: "executionResult",
          provider: "volcengine"
        },
        evidence: {
          runId: "run-enrichment"
        }
      },
      llmRaw: null,
      createdAt: "2026-04-28T00:00:00.000Z"
    };

    const enriched = service.withPromptTemplateEvidence(run);

    expect(enriched.delivery?.evidence?.v2).toMatchObject({
      runtimePlan: run.trace.v2?.runtimePlan,
      artifactRefs: run.trace.v2?.artifactRefs,
      smartDefaults: run.trace.v2?.smartDefaults
    });
  });
});
