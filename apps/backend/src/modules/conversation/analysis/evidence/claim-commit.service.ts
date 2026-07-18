import { Injectable } from "@nestjs/common";
import type {
  AnalysisCalculationV1,
  AnalysisClaimV1,
  AnalysisEvidenceAlignmentV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { sha256Digest, stableJson } from "../../../platform/data/persistence/analysis-ledger.util";

@Injectable()
export class ClaimCommitService {
  build(input: {
    kind: AnalysisClaimV1["kind"];
    statement: string;
    calculation: AnalysisCalculationV1;
    calculationRef: string;
    alignment: AnalysisEvidenceAlignmentV1;
    alignmentRef: string;
    scope: string;
    contradictingEvidenceRefs?: string[];
    unknowns?: string[];
    alternatives?: string[];
    validFrom?: string;
    validTo?: string;
  }): AnalysisClaimV1 {
    const supportingEvidenceRefs = [...new Set(input.alignment.evidenceRefs)].sort();
    if (
      !input.alignment.closed ||
      supportingEvidenceRefs.length === 0 ||
      !input.calculationRef ||
      !input.statement.trim()
    ) {
      throw new DomainError(
        "ANALYSIS_UNSUPPORTED_CLAIM_REJECTED",
        "Claim 需要 closed alignment、supporting Evidence 与 Calculation。",
        409
      );
    }
    const contradictingEvidenceRefs = [
      ...new Set(input.contradictingEvidenceRefs ?? [])
    ].sort();
    const unknowns = [...new Set(input.unknowns ?? [])].sort();
    const alternatives = [...new Set(input.alternatives ?? [])].sort();
    const strength: AnalysisClaimV1["strength"] =
      unknowns.length > 0
        ? "weak"
        : contradictingEvidenceRefs.length > 0 || input.kind === "inference"
          ? "moderate"
          : input.kind === "judgment"
            ? "weak"
            : "strong";
    const unsigned = {
      kind: input.kind,
      statement: input.statement.trim(),
      value: input.calculation.output.value,
      ...(input.calculation.output.unit
        ? { unit: input.calculation.output.unit }
        : {}),
      supportingEvidenceRefs,
      contradictingEvidenceRefs,
      calculationRefs: [input.calculationRef],
      alignmentRef: input.alignmentRef,
      scope: input.scope,
      ...(input.validFrom ? { validFrom: input.validFrom } : {}),
      ...(input.validTo ? { validTo: input.validTo } : {}),
      unknowns,
      alternatives,
      strength
    };
    return {
      version: "analysis-claim.v1",
      claimId: `claim:${sha256Digest(stableJson(unsigned))}`,
      ...unsigned
    };
  }
}
