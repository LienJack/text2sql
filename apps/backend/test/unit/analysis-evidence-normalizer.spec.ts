import type { CommittedAnalysisArtifactPayload } from "../../src/modules/platform/data/persistence/analysis-artifact.repository";
import { EvidenceNormalizerService } from "../../src/modules/conversation/analysis/evidence/evidence-normalizer.service";

describe("EvidenceNormalizerService", () => {
  const service = new EvidenceNormalizerService();

  it("promotes verified SQL rows into typed evidence with deterministic calculation hint", () => {
    const [evidence] = service.normalize(sqlArtifact());

    expect(evidence.sourceKind).toBe("sql");
    expect(evidence.observations.map((item) => item.metric)).toEqual([
      "current_value",
      "baseline_value"
    ]);
    expect(evidence.calculationHint).toMatchObject({
      operator: "percent_change",
      outputUnit: "%"
    });
    expect(evidence.authorization.receiptRefs).toEqual(["receipt-1"]);
  });

  it("rejects SQL rows when final accuracy receipts are not passed", () => {
    const artifact = sqlArtifact();
    artifact.payload.accuracy = {
      executionStatus: "passed",
      resultStatus: "failed",
      validationStatus: "passed"
    };

    expect(() => service.normalize(artifact)).toThrow(
      "SQL source Artifact 缺少通过的 execution/result/validation Receipt"
    );
  });
});

function sqlArtifact(): CommittedAnalysisArtifactPayload {
  return {
    id: "sql-artifact-1",
    taskId: "task-1",
    revisionId: "revision-1",
    attemptId: "attempt-1",
    artifactType: "analysis.sql_evidence",
    schemaVersion: "analysis-sql-evidence.v1",
    payloadDigest: "sql-digest",
    completeness: "complete",
    payload: {
      runId: "run-1",
      columns: ["current_value", "baseline_value"],
      rowsPreview: [{ current_value: "80", baseline_value: "100" }],
      rowCount: 1,
      accuracy: {
        executionStatus: "passed",
        resultStatus: "passed",
        validationStatus: "passed",
        receiptRefs: ["receipt-1"]
      },
      evidenceMetadata: {
        entities: ["company:acme"],
        effectiveFrom: "2026-04-01T00:00:00.000Z",
        effectiveTo: "2026-06-30T23:59:59.000Z",
        timezone: "UTC",
        grain: "quarter",
        units: { current_value: "USD", baseline_value: "USD" },
        missingIntervals: []
      }
    }
  };
}
