import { Injectable } from "@nestjs/common";
import type {
  AnalysisAlignmentCheckV1,
  AnalysisCalculationContractV1,
  AnalysisConflictSetV1,
  AnalysisEvidenceAlignmentV1,
  AnalysisEvidenceV1
} from "@text2sql/shared-types";
import { stableJson } from "../../../platform/data/persistence/analysis-ledger.util";

@Injectable()
export class AlignmentObligationService {
  evaluate(input: {
    evidence: AnalysisEvidenceV1[];
    conflicts?: AnalysisConflictSetV1[];
  }): AnalysisEvidenceAlignmentV1 {
    const evidenceRefs = input.evidence.map((item) => item.evidenceId);
    const checks: AnalysisAlignmentCheckV1[] = [
      this.entityCheck(input.evidence),
      this.timeCheck(input.evidence),
      this.unitCheck(input.evidence),
      this.grainCheck(input.evidence),
      this.missingCheck(input.evidence),
      this.conflictCheck(input.conflicts ?? [], evidenceRefs)
    ];
    const unresolvedDimensions = checks
      .filter((check) => check.status !== "passed")
      .map((check) => check.dimension);
    const calculationContract = this.resolveCalculationContract(input.evidence);
    return {
      version: "analysis-evidence-alignment.v1",
      evidenceRefs,
      checks,
      closed: unresolvedDimensions.length === 0,
      requiresHumanDecision: checks.some(
        (check) =>
          check.status !== "passed" &&
          ["entity", "time", "unit", "grain", "conflict"].includes(
            check.dimension
          )
      ),
      unresolvedDimensions,
      ...(calculationContract ? { calculationContract } : {})
    };
  }

  private entityCheck(evidence: AnalysisEvidenceV1[]): AnalysisAlignmentCheckV1 {
    const withEntities = evidence.filter((item) => item.metadata.entities.length > 0);
    if (withEntities.length !== evidence.length || evidence.length === 0) {
      return check("entity", "unknown", ["entity_scope_incomplete"], evidence);
    }
    const normalized = withEntities.map(
      (item) =>
        new Set(
          item.metadata.entities.map(
            (entity) => item.metadata.entityAliases[entity] ?? entity
          )
        )
    );
    const intersection = [...normalized[0]].filter((entity) =>
      normalized.every((set) => set.has(entity))
    );
    return intersection.length > 0
      ? check("entity", "passed", ["entity_scope_intersects"], evidence)
      : check("entity", "failed", ["entity_scope_conflict"], evidence);
  }

  private timeCheck(evidence: AnalysisEvidenceV1[]): AnalysisAlignmentCheckV1 {
    if (evidence.length === 0) {
      return check("time", "unknown", ["time_scope_missing"], evidence);
    }
    const ranges = evidence.map((item) => ({
      from: timestamp(item.metadata.effectiveFrom ?? item.metadata.observedAt),
      to: timestamp(
        item.metadata.effectiveTo ??
          item.metadata.effectiveFrom ??
          item.metadata.observedAt
      ),
      timezone: item.metadata.timezone
    }));
    if (ranges.some((range) => range.from === undefined || range.to === undefined)) {
      return check("time", "unknown", ["time_scope_incomplete"], evidence);
    }
    const timezones = new Set(ranges.map((range) => range.timezone).filter(Boolean));
    if (timezones.size > 1) {
      return check("time", "failed", ["timezone_conflict"], evidence);
    }
    const latestFrom = Math.max(...ranges.map((range) => range.from as number));
    const earliestTo = Math.min(...ranges.map((range) => range.to as number));
    return latestFrom <= earliestTo
      ? check("time", "passed", ["time_ranges_overlap"], evidence)
      : check("time", "failed", ["time_ranges_do_not_overlap"], evidence);
  }

  private unitCheck(evidence: AnalysisEvidenceV1[]): AnalysisAlignmentCheckV1 {
    const observations = evidence.flatMap((item) => item.observations);
    if (observations.length === 0 || observations.some((item) => !item.unit)) {
      return check("unit", "unknown", ["unit_metadata_incomplete"], evidence);
    }
    const byMetric = new Map<string, Set<string>>();
    for (const observation of observations) {
      const units = byMetric.get(observation.metric) ?? new Set<string>();
      units.add(observation.unit as string);
      byMetric.set(observation.metric, units);
    }
    return [...byMetric.values()].every((units) => units.size === 1)
      ? check("unit", "passed", ["metric_units_aligned"], evidence)
      : check("unit", "failed", ["metric_unit_conflict"], evidence);
  }

  private grainCheck(evidence: AnalysisEvidenceV1[]): AnalysisAlignmentCheckV1 {
    const grains = evidence.map(
      (item) => item.metadata.grain ?? item.observations[0]?.grain
    );
    if (evidence.length === 0 || grains.some((grain) => !grain)) {
      return check("grain", "unknown", ["grain_metadata_incomplete"], evidence);
    }
    return new Set(grains).size === 1
      ? check("grain", "passed", ["grain_aligned"], evidence)
      : check("grain", "failed", ["grain_conflict"], evidence);
  }

  private missingCheck(evidence: AnalysisEvidenceV1[]): AnalysisAlignmentCheckV1 {
    const missing = evidence.flatMap((item) => item.metadata.missingIntervals);
    return missing.length === 0
      ? check("missing", "passed", ["no_missing_interval_declared"], evidence)
      : check("missing", "failed", ["missing_intervals_present"], evidence);
  }

  private conflictCheck(
    conflicts: AnalysisConflictSetV1[],
    evidenceRefs: string[]
  ): AnalysisAlignmentCheckV1 {
    const unresolved = conflicts.filter((conflict) => conflict.status === "unresolved");
    return {
      dimension: "conflict",
      status: unresolved.length === 0 ? "passed" : "failed",
      reasonCodes:
        unresolved.length === 0
          ? ["no_unresolved_conflict"]
          : ["unresolved_conflict_present"],
      evidenceRefs
    };
  }

  private resolveCalculationContract(
    evidence: AnalysisEvidenceV1[]
  ): AnalysisCalculationContractV1 | undefined {
    const hinted = evidence
      .filter((item) => item.calculationHint)
      .map((item) => ({
        evidenceId: item.evidenceId,
        contract: item.calculationHint as AnalysisCalculationContractV1
      }));
    if (hinted.length === 0) {
      return undefined;
    }
    const digests = new Set(
      hinted.map(({ contract }) => stableJson({ ...contract, inputs: contract.inputs.map((input) => ({ ...input, evidenceRef: "bound" })) }))
    );
    if (digests.size !== 1) {
      return undefined;
    }
    const selected = hinted[0];
    return {
      ...selected.contract,
      inputs: selected.contract.inputs.map((input) => ({
        ...input,
        evidenceRef:
          input.evidenceRef === "self" ? selected.evidenceId : input.evidenceRef
      }))
    };
  }
}

function check(
  dimension: AnalysisAlignmentCheckV1["dimension"],
  status: AnalysisAlignmentCheckV1["status"],
  reasonCodes: string[],
  evidence: AnalysisEvidenceV1[]
): AnalysisAlignmentCheckV1 {
  return {
    dimension,
    status,
    reasonCodes,
    evidenceRefs: evidence.map((item) => item.evidenceId)
  };
}

function timestamp(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}
