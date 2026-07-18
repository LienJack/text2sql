import { Injectable } from "@nestjs/common";
import type {
  AnalysisCalculationContractV1,
  AnalysisEvidenceObservationV1,
  AnalysisEvidenceV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import type { CommittedAnalysisArtifactPayload } from "../../../platform/data/persistence/analysis-artifact.repository";
import { sha256Digest, stableJson } from "../../../platform/data/persistence/analysis-ledger.util";

@Injectable()
export class EvidenceNormalizerService {
  normalize(artifact: CommittedAnalysisArtifactPayload): AnalysisEvidenceV1[] {
    if (artifact.artifactType === "analysis.sql_evidence") {
      return [this.normalizeSql(artifact)];
    }
    if (artifact.artifactType === "analysis.research_evidence") {
      return this.normalizeResearch(artifact);
    }
    return [];
  }

  private normalizeSql(
    artifact: CommittedAnalysisArtifactPayload
  ): AnalysisEvidenceV1 {
    const accuracy = record(artifact.payload.accuracy);
    const receiptRefs = strings(accuracy.receiptRefs);
    const statuses = [
      accuracy.executionStatus,
      accuracy.resultStatus,
      accuracy.validationStatus
    ];
    if (statuses.some((status) => status !== "passed")) {
      throw new DomainError(
        "ANALYSIS_SQL_EVIDENCE_NOT_VERIFIED",
        "SQL source Artifact 缺少通过的 execution/result/validation Receipt。",
        409
      );
    }
    const rows = records(artifact.payload.rowsPreview);
    const columns = strings(artifact.payload.columns);
    const evidenceMetadata = record(artifact.payload.evidenceMetadata);
    const observations = this.sqlObservations(rows, columns, evidenceMetadata);
    const evidenceId = `evidence:${sha256Digest(
      stableJson({ sourceArtifactRef: artifact.id, sourceDigest: artifact.payloadDigest })
    )}`;
    return {
      version: "analysis-evidence.v1",
      evidenceId,
      sourceKind: "sql",
      sourceArtifactRef: artifact.id,
      sourceRef: stringValue(artifact.payload.runId) ?? artifact.id,
      sourceDigest: artifact.payloadDigest,
      authorization: {
        policyRefs: strings(evidenceMetadata.policyRefs),
        receiptRefs
      },
      metadata: metadata(evidenceMetadata),
      observations,
      completeness: artifact.completeness,
      qualityFlags: [
        ...(numberValue(artifact.payload.rowCount) > rows.length
          ? ["rows_preview_truncated"]
          : []),
        ...(observations.length === 0 ? ["no_numeric_observation"] : [])
      ],
      lineage: {
        taskId: artifact.taskId,
        revisionId: artifact.revisionId,
        ...(artifact.attemptId ? { attemptId: artifact.attemptId } : {}),
        inputDigest: artifact.payloadDigest
      },
      ...(calculationHint(evidenceMetadata, observations)
        ? { calculationHint: calculationHint(evidenceMetadata, observations) }
        : {})
    };
  }

  private normalizeResearch(
    artifact: CommittedAnalysisArtifactPayload
  ): AnalysisEvidenceV1[] {
    const coverage = record(artifact.payload.coverage);
    if (coverage.status !== "complete" && coverage.status !== "conflicted") {
      throw new DomainError(
        "ANALYSIS_RESEARCH_EVIDENCE_NOT_VERIFIED",
        "Research source Artifact 未关闭 coverage obligations。",
        409
      );
    }
    const brief = record(artifact.payload.brief);
    return records(artifact.payload.sourceSnapshots).map((snapshot) => {
      const sourceRef = stringValue(snapshot.snapshotId) ?? "missing-snapshot";
      const sourceDigest = stringValue(snapshot.contentDigest) ?? "";
      if (!sourceDigest) {
        throw new DomainError(
          "ANALYSIS_RESEARCH_SNAPSHOT_DIGEST_REQUIRED",
          "Research Evidence 必须绑定 SourceSnapshot digest。",
          409
        );
      }
      return {
        version: "analysis-evidence.v1" as const,
        evidenceId: `evidence:${sha256Digest(
          stableJson({ sourceArtifactRef: artifact.id, sourceRef, sourceDigest })
        )}`,
        sourceKind: "web" as const,
        sourceArtifactRef: artifact.id,
        sourceRef,
        sourceDigest,
        ...(stringValue(snapshot.locator)
          ? { locator: stringValue(snapshot.locator) }
          : {}),
        authorization: {
          policyRefs: [
            `policy:${stringValue(brief.policyDigest) ?? "missing"}`,
            `connector:${stringValue(brief.connectorConfigDigest) ?? "missing"}`
          ],
          receiptRefs: [`snapshot:${sourceRef}`]
        },
        metadata: metadata(record(snapshot.evidenceMetadata)),
        observations: observationsFromUnknown(snapshot.observations),
        completeness: completeness(snapshot.completeness),
        qualityFlags: strings(snapshot.injectionIndicators).map(
          (indicator) => `untrusted_content:${indicator}`
        ),
        lineage: {
          taskId: artifact.taskId,
          revisionId: artifact.revisionId,
          ...(artifact.attemptId ? { attemptId: artifact.attemptId } : {}),
          inputDigest: artifact.payloadDigest
        }
      };
    });
  }

  private sqlObservations(
    rows: Array<Record<string, unknown>>,
    columns: string[],
    evidenceMetadata: Record<string, unknown>
  ): AnalysisEvidenceObservationV1[] {
    const configured = observationsFromUnknown(evidenceMetadata.observations);
    if (configured.length > 0) {
      return configured;
    }
    const numericColumns = columns.filter((column) =>
      rows.some((row) => decimalValue(row[column]) !== undefined)
    );
    const dimensionColumns = columns.filter(
      (column) => !numericColumns.includes(column)
    );
    return rows.flatMap((row) =>
      numericColumns.flatMap((metric) => {
        const value = decimalValue(row[metric]);
        if (value === undefined) {
          return [];
        }
        return [
          {
            metric,
            value,
            dimensions: Object.fromEntries(
              dimensionColumns
                .filter((column) => row[column] !== null && row[column] !== undefined)
                .map((column) => [column, String(row[column])])
            ),
            ...(stringValue(evidenceMetadata.observedAt)
              ? { observedAt: stringValue(evidenceMetadata.observedAt) }
              : {}),
            ...(stringValue(record(evidenceMetadata.units)[metric])
              ? { unit: stringValue(record(evidenceMetadata.units)[metric]) }
              : {}),
            ...(stringValue(evidenceMetadata.grain)
              ? { grain: stringValue(evidenceMetadata.grain) }
              : {})
          }
        ];
      })
    );
  }
}

function metadata(value: Record<string, unknown>): AnalysisEvidenceV1["metadata"] {
  return {
    entities: strings(value.entities),
    entityAliases: Object.fromEntries(
      Object.entries(record(value.entityAliases)).map(([key, alias]) => [
        key,
        String(alias)
      ])
    ),
    ...(stringValue(value.effectiveFrom)
      ? { effectiveFrom: stringValue(value.effectiveFrom) }
      : {}),
    ...(stringValue(value.effectiveTo)
      ? { effectiveTo: stringValue(value.effectiveTo) }
      : {}),
    ...(stringValue(value.observedAt)
      ? { observedAt: stringValue(value.observedAt) }
      : {}),
    ...(stringValue(value.timezone) ? { timezone: stringValue(value.timezone) } : {}),
    ...(stringValue(value.grain) ? { grain: stringValue(value.grain) } : {}),
    units: Object.fromEntries(
      Object.entries(record(value.units)).map(([key, unit]) => [key, String(unit)])
    ),
    missingIntervals: strings(value.missingIntervals)
  };
}

function calculationHint(
  metadataValue: Record<string, unknown>,
  observations: AnalysisEvidenceObservationV1[]
): AnalysisCalculationContractV1 | undefined {
  const configured = record(metadataValue.calculationContract);
  if (configured.version === "analysis-calculation-contract.v1") {
    return configured as unknown as AnalysisCalculationContractV1;
  }
  const current = observations.find((item) => item.metric === "current_value");
  const baseline = observations.find((item) => item.metric === "baseline_value");
  if (!current || !baseline) {
    return undefined;
  }
  return {
    version: "analysis-calculation-contract.v1",
    operatorVersion: "deterministic-decimal.v1",
    operator: "percent_change",
    inputs: [
      { name: "current", value: current.value, evidenceRef: "self" },
      { name: "baseline", value: baseline.value, evidenceRef: "self" }
    ],
    precision: 2,
    rounding: "half_up",
    nullPolicy: "reject",
    outputUnit: "%"
  };
}

function observationsFromUnknown(value: unknown): AnalysisEvidenceObservationV1[] {
  return records(value)
    .map((item) => ({
      metric: stringValue(item.metric) ?? "",
      value:
        typeof item.value === "number" || typeof item.value === "string"
          ? item.value
          : item.value === null
            ? null
            : "",
      dimensions: Object.fromEntries(
        Object.entries(record(item.dimensions)).map(([key, dimension]) => [
          key,
          String(dimension)
        ])
      ),
      ...(stringValue(item.observedAt)
        ? { observedAt: stringValue(item.observedAt) }
        : {}),
      ...(stringValue(item.unit) ? { unit: stringValue(item.unit) } : {}),
      ...(stringValue(item.grain) ? { grain: stringValue(item.grain) } : {})
    }))
    .filter((item) => item.metric);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decimalValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function completeness(value: unknown): AnalysisEvidenceV1["completeness"] {
  return value === "partial" ||
    value === "conflicted" ||
    value === "insufficient" ||
    value === "unavailable"
    ? value
    : "complete";
}
