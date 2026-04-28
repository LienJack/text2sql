import {
  REQUIRED_TEXT2SQL_V2_ARTIFACT_CATEGORIES,
  Text2SqlV2ArtifactRefService
} from "../../src/modules/conversation/artifacts/text2sql-v2-artifact-ref.service";
import type { SqlRun } from "@text2sql/shared-types";

const createService = (writeReplay: jest.Mock) =>
  new Text2SqlV2ArtifactRefService({
    rag: {
      replay: {
        writeReplay
      }
    }
  } as never);

const createRun = (evidenceCount: number): SqlRun => ({
  runId: "run-artifact-ref",
  sessionId: "session-artifact-ref",
  question: "统计订单",
  status: "executionResult",
  provider: "volcengine",
  answer: "ok",
  trace: {
    runId: "run-artifact-ref",
    provider: "volcengine",
    retryCount: 0,
    steps: [],
    v2: {
      version: "v2",
      stageOrder: [
        "intake",
        "retrieve",
        "assemble-context",
        "semantic-plan",
        "generate-sql",
        "validate",
        "correct",
        "execute",
        "answer"
      ],
      stages: [
        {
          stage: "answer",
          status: "success"
        }
      ],
      contextPack: {
        status: "ready",
        selectedEvidenceIds: Array.from(
          { length: evidenceCount },
          (_, index) => `chunk-${index + 1}`
        ),
        selectedTables: ["orders"],
        selectedColumns: ["orders.id"]
      }
    }
  },
  llmRaw: null,
  createdAt: "2026-04-28T00:00:00.000Z"
});

describe("Text2SqlV2ArtifactRefService", () => {
  it("writes large context summaries through the knowledge facade and exposes safe refs", async () => {
    const writeReplay = jest.fn().mockResolvedValue(undefined);
    const service = createService(writeReplay);

    const run = await service.attachRunArtifactRefs(createRun(30), "ds-main");

    expect(writeReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-artifact-ref",
        datasourceId: "ds-main",
        replayKey: expect.stringMatching(/^text2sql:artifact:context_snippets:/),
        stage: "text2sql_artifact_ref",
        payload: expect.objectContaining({
          version: "text2sql-artifact-summary.v1",
          sanitizedSummary: "Compacted 30 selected context evidence ids.",
          payload: expect.objectContaining({
            selectedEvidenceIds: expect.arrayContaining(["chunk-1", "chunk-30"])
          })
        })
      })
    );
    expect(run.trace.v2?.artifactRefs?.[0]).toMatchObject({
      category: "context_snippets",
      summary: "Compacted 30 selected context evidence ids.",
      visibility: "user",
      sensitivity: "none",
      reasonCodes: ["large_context_compacted"]
    });
  });

  it("writes stable refs for every required runtime artifact category", async () => {
    const writeReplay = jest.fn().mockResolvedValue(undefined);
    const service = createService(writeReplay);
    const run = createRun(30);
    run.sql = "SELECT COUNT(*) AS total FROM orders";
    run.model = "deepseek-v3";
    run.columns = ["total"];
    run.rows = [
      { total: 1 },
      { total: 2 },
      { total: 3 },
      { total: 4 }
    ];
    run.trace.promptTemplate = {
      templateId: "text2sql-default",
      version: 3,
      fallbackReason: "workspace_default"
    };
    run.trace.v2!.sqlGeneration = {
      sql: run.sql,
      usedTables: ["orders"],
      usedColumns: ["orders.id"],
      evidenceRefs: ["chunk-1"],
      correctionGrounding: {
        failedSqlRef: "sha256:failed",
        retryReason: "dry run failed",
        failureCode: "SQL_DRY_RUN_PARSE_REJECTED",
        attemptCount: 1,
        maxAttempts: 2,
        evidenceRefs: ["chunk-1"]
      }
    };
    run.trace.v2!.sqlValidation = {
      status: "failed",
      correctable: true,
      checks: [
        {
          check: "dry-run",
          status: "failed",
          code: "SQL_DRY_RUN_PARSE_REJECTED",
          message: "dry run rejected"
        }
      ],
      failure: {
        code: "SQL_DRY_RUN_PARSE_REJECTED",
        message: "dry run rejected",
        category: "validation",
        terminal: false,
        correctable: true
      }
    };
    run.trace.v2!.smartDefaults = {
      bundleId: "smart-defaults",
      version: "2026-04-28",
      coveredStages: ["generate-sql"],
      ruleIds: ["prompt-template-overlay"],
      status: "applied"
    };

    const withRefs = await service.attachRunArtifactRefs(run, "ds-main");

    const categories = withRefs.trace.v2?.artifactRefs?.map((ref) => ref.category);
    expect(categories).toEqual(expect.arrayContaining([...REQUIRED_TEXT2SQL_V2_ARTIFACT_CATEGORIES]));
    expect(writeReplay).toHaveBeenCalledTimes(REQUIRED_TEXT2SQL_V2_ARTIFACT_CATEGORIES.length);
    expect(
      withRefs.trace.v2?.artifactRefs?.filter(
        (ref) => ref.category === "provider_output_summary"
      )[0]
    ).toMatchObject({
      sensitivity: "provider_raw",
      reasonCodes: expect.arrayContaining(["provider_output_summarized"])
    });
  });

  it("deduplicates producer refs against existing trace refs", async () => {
    const writeReplay = jest.fn().mockResolvedValue(undefined);
    const service = createService(writeReplay);
    const run = createRun(30);
    const prepared = await service.attachRunArtifactRefs(run, "ds-main");

    writeReplay.mockClear();
    const secondPass = await service.attachRunArtifactRefs(prepared, "ds-main");

    expect(writeReplay).not.toHaveBeenCalled();
    expect(secondPass.trace.v2?.artifactRefs?.map((ref) => ref.id)).toEqual(
      prepared.trace.v2?.artifactRefs?.map((ref) => ref.id)
    );
  });

  it("does not persist permission-filtered raw payloads", async () => {
    const writeReplay = jest.fn().mockResolvedValue(undefined);
    const service = createService(writeReplay);
    const run = createRun(30);
    run.trace.v2!.contextPack!.permissionFiltering = {
      status: "applied",
      deniedEvidenceCount: 1
    };

    await service.attachRunArtifactRefs(run, "ds-main");

    expect(writeReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          ref: expect.objectContaining({
            sensitivity: "permission_filtered"
          }),
          payload: undefined
        })
      })
    );
  });

  it("surfaces artifact write failures as warnings without fake refs", async () => {
    const writeReplay = jest.fn().mockRejectedValue(new Error("storage down"));
    const service = createService(writeReplay);

    const run = await service.attachRunArtifactRefs(createRun(30), "ds-main");

    expect(run.trace.v2?.artifactRefs).toBeUndefined();
    expect(run.trace.v2?.stages.find((stage) => stage.stage === "answer")?.warnings).toEqual(
      expect.arrayContaining([
        "artifact_ref_write_failed:context_snippets",
        "artifact_ref_write_failed:schema_supplement",
        "artifact_ref_write_failed:provider_output_summary"
      ])
    );
  });

  it("omits raw payloads for provider, prompt, permission-filtered, and sensitive refs", async () => {
    const writeReplay = jest.fn().mockResolvedValue(undefined);
    const service = createService(writeReplay);
    const run = createRun(30);
    run.trace.promptTemplate = {
      templateId: "text2sql-default",
      version: 3
    };
    run.trace.v2!.contextPack!.permissionFiltering = {
      status: "applied",
      deniedEvidenceCount: 1
    };

    await service.attachRunArtifactRefs(run, "ds-main");

    const payloads = writeReplay.mock.calls.map((call) => call[0].payload);
    expect(
      payloads
        .filter((payload) =>
          ["provider_output_summary", "prompt_input", "schema_supplement"].includes(
            payload.ref.category
          )
        )
        .every((payload) => payload.payload === undefined)
    ).toBe(true);
  });
});
