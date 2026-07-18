import { Injectable } from "@nestjs/common";
import type {
  AnalysisClaimV1,
  AnalysisConflictSetV1,
  AnalysisReportV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { sha256Digest, stableJson } from "../../../platform/data/persistence/analysis-ledger.util";

@Injectable()
export class AnalysisReportProjectorService {
  project(input: {
    title: string;
    claims: Array<{ artifactRef: string; claim: AnalysisClaimV1 }>;
    conflicts?: Array<{ artifactRef: string; conflict: AnalysisConflictSetV1 }>;
    limitations?: string[];
  }): AnalysisReportV1 {
    const claims = input.claims.filter(
      ({ claim }) => claim.strength !== "unsupported"
    );
    if (claims.length === 0) {
      throw new DomainError(
        "ANALYSIS_REPORT_SUPPORTED_CLAIM_REQUIRED",
        "Report projector 至少需要一个 committed supported Claim。",
        409
      );
    }
    const conflicts = input.conflicts ?? [];
    const limitations = [
      ...new Set([
        ...(input.limitations ?? []),
        ...claims.flatMap(({ claim }) => claim.unknowns),
        ...(conflicts.some(({ conflict }) => conflict.status === "unresolved")
          ? ["存在未解决的竞争证据，结论仅在已声明条件下成立。"]
          : [])
      ])
    ].sort();
    const unsigned = {
      version: "analysis-report.v1" as const,
      title: input.title.trim() || "自治分析报告",
      summary: claims.map(({ claim }) => claim.statement).join("；"),
      sections: [
        {
          heading: "有证据支持的结论",
          claimRefs: claims.map(({ artifactRef }) => artifactRef),
          statements: claims.map(({ claim }) => claim.statement)
        }
      ],
      claims: claims.map(({ claim }) => claim),
      conflictRefs: conflicts.map(({ artifactRef }) => artifactRef),
      limitations,
      chartSpecs: claims
        .filter(({ claim }) => claim.value !== undefined)
        .map(({ artifactRef, claim }) => ({
          title: claim.statement,
          type: "metric" as const,
          claimRefs: [artifactRef],
          evidenceRefs: [...claim.supportingEvidenceRefs]
        }))
    };
    this.assertNumericGrounding(unsigned, claims.map(({ claim }) => claim));
    return {
      ...unsigned,
      projectionDigest: sha256Digest(stableJson(unsigned))
    };
  }

  assertNumericGrounding(
    report: Omit<AnalysisReportV1, "projectionDigest">,
    claims: AnalysisClaimV1[]
  ): void {
    const supportedNumbers = new Set(
      claims
        .flatMap((claim) => [claim.value, ...numbers(claim.statement)])
        .filter((value): value is string => Boolean(value))
        .map(normalizeNumber)
    );
    const reportNumbers = [
      ...numbers(report.summary),
      ...report.sections.flatMap((section) =>
        section.statements.flatMap(numbers)
      ),
      ...report.chartSpecs.flatMap((chart) => numbers(chart.title))
    ];
    const unsupported = reportNumbers.filter(
      (value) => !supportedNumbers.has(normalizeNumber(value))
    );
    if (unsupported.length > 0) {
      throw new DomainError(
        "ANALYSIS_REPORT_UNGROUNDED_NUMBER",
        "Report 试图投影 Claim 中不存在的数字。",
        409
      );
    }
  }
}

function numbers(value: string): string[] {
  return [...value.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => match[0]);
}

function normalizeNumber(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : value;
}
