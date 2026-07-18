import { Injectable } from "@nestjs/common";
import type {
  AnalysisConflictSetV1,
  AnalysisEvidenceV1
} from "@text2sql/shared-types";
import { sha256Digest, stableJson } from "../../../platform/data/persistence/analysis-ledger.util";

@Injectable()
export class ConflictSetService {
  detect(evidence: AnalysisEvidenceV1[]): AnalysisConflictSetV1[] {
    const groups = new Map<
      string,
      Map<string, { evidenceRefs: Set<string>; conditions: Set<string>; unit?: string }>
    >();
    for (const item of evidence) {
      for (const observation of item.observations) {
        if (observation.value === null) {
          continue;
        }
        const comparisonKey = stableJson({
          metric: observation.metric,
          dimensions: observation.dimensions,
          observedAt: observation.observedAt ?? item.metadata.observedAt ?? null,
          grain: observation.grain ?? item.metadata.grain ?? null
        });
        const byValue = groups.get(comparisonKey) ?? new Map();
        const value = String(observation.value);
        const existing = byValue.get(value) ?? {
          evidenceRefs: new Set<string>(),
          conditions: new Set<string>(),
          ...(observation.unit ? { unit: observation.unit } : {})
        };
        existing.evidenceRefs.add(item.evidenceId);
        existing.conditions.add(`source_kind:${item.sourceKind}`);
        byValue.set(value, existing);
        groups.set(comparisonKey, byValue);
      }
    }
    return [...groups.entries()]
      .filter(([, values]) => values.size > 1)
      .map(([comparisonKey, values]) => ({
        version: "analysis-conflict-set.v1" as const,
        conflictId: `conflict:${sha256Digest(
          stableJson({ comparisonKey, values: [...values.keys()].sort() })
        )}`,
        comparisonKey,
        competingValues: [...values.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([value, details]) => ({
            value,
            ...(details.unit ? { unit: details.unit } : {}),
            evidenceRefs: [...details.evidenceRefs].sort(),
            conditions: [...details.conditions].sort()
          })),
        status: "unresolved" as const
      }));
  }
}
