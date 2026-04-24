import { Injectable } from "@nestjs/common";
import { SemanticSpineRepository } from "./semantic-spine.repository";
import type {
  SemanticSpineCalculatedFieldDefinition,
  SemanticSpineMetricDefinition,
  SemanticSpineModelDefinition,
  SemanticSpineRelationshipDefinition,
  SemanticSpineSnapshotDocument
} from "./semantic-spine.types";

const MODELING_REVISION_MISSING_RISK_TAG = "modeling_revision_missing";
const SEMANTIC_SPINE_DEGRADED_RISK_TAG = "semantic_spine_degraded";
const DEFAULT_SEMANTIC_SPINE_DEGRADE_REASON = "semantic_spine_snapshot_unavailable";

export interface SemanticSpineCompileInput {
  domain: string;
  datasourceId?: string;
  semanticVersion?: number;
  modelingRevision?: number;
}

export interface SemanticSpineCompileEvidence {
  matchedDomain?: string;
  matchedScope?: "datasource" | "global";
  matchedObjectKeys: string[];
  missingObjectKeys: string[];
  degradeReason?: string;
  modelingRevision?: number;
}

export interface SemanticSpineCompileOutput {
  status: "ready" | "degraded";
  semanticVersion?: number;
  semanticBindings: {
    models: Record<string, SemanticSpineModelDefinition>;
    relationships: Record<string, SemanticSpineRelationshipDefinition>;
    metrics: Record<string, SemanticSpineMetricDefinition>;
    calculatedFields: Record<string, SemanticSpineCalculatedFieldDefinition>;
  };
  instructionSets: {
    modelBindings: Array<{
      key: string;
      name: string;
      binding: string;
      description?: string;
    }>;
    relationshipBindings: Array<{
      key: string;
      fromModel: string;
      toModel: string;
      binding?: string;
      condition?: string;
    }>;
    metricBindings: Array<{
      key: string;
      model: string;
      binding: string;
      aggregation?: string;
      expression?: string;
    }>;
    calculatedFieldBindings: Array<{
      key: string;
      model: string;
      binding: string;
      dataType?: string;
      expression?: string;
    }>;
  };
  confidence: {
    score: number;
    degraded: boolean;
  };
  riskTags: string[];
  evidence: SemanticSpineCompileEvidence;
}

@Injectable()
export class SemanticSpineCompilerService {
  constructor(private readonly repository: SemanticSpineRepository) {}

  async compile(input: SemanticSpineCompileInput): Promise<SemanticSpineCompileOutput> {
    const resolved = await this.repository.resolveSnapshot({
      domain: input.domain,
      datasourceId: input.datasourceId,
      semanticVersion: input.semanticVersion
    });

    if (resolved.status !== "ready" || !resolved.snapshot) {
      const modelingRevision = this.resolveModelingRevision(input.modelingRevision);
      const degradeReason =
        resolved.degrade_reason ?? DEFAULT_SEMANTIC_SPINE_DEGRADE_REASON;
      return {
        status: "degraded",
        semanticVersion: resolved.semantic_version,
        semanticBindings: {
          models: {},
          relationships: {},
          metrics: {},
          calculatedFields: {}
        },
        instructionSets: {
          modelBindings: [],
          relationshipBindings: [],
          metricBindings: [],
          calculatedFieldBindings: []
        },
        confidence: {
          score: 0,
          degraded: true
        },
        riskTags: this.withModelingRevisionRiskTag(
          [SEMANTIC_SPINE_DEGRADED_RISK_TAG, ...(resolved.risk_tags ?? [])],
          modelingRevision
        ),
        evidence: {
          matchedDomain: resolved.matched_domain,
          matchedScope: resolved.matched_scope,
          matchedObjectKeys: [],
          missingObjectKeys: ["models", "relationships", "metrics", "calculatedFields"],
          degradeReason,
          modelingRevision
        }
      };
    }

    const modelingRevision = this.resolveModelingRevision(
      input.modelingRevision,
      resolved.snapshot
    );

    return this.buildReadyOutput(resolved.snapshot, {
      modelingRevision,
      semanticVersion: resolved.semantic_version,
      matchedDomain: resolved.matched_domain,
      matchedScope: resolved.matched_scope,
      riskTags: resolved.risk_tags ?? []
    });
  }

  private buildReadyOutput(
    snapshot: SemanticSpineSnapshotDocument,
    meta: {
      modelingRevision?: number;
      semanticVersion?: number;
      matchedDomain?: string;
      matchedScope?: "datasource" | "global";
      riskTags: string[];
    }
  ): SemanticSpineCompileOutput {
    const calculatedFields = this.readCalculatedFields(snapshot);
    const modelBindings = snapshot.models.map((model) => ({
      key: model.key,
      name: model.name,
      binding: model.binding,
      description: model.description
    }));
    const relationshipBindings = snapshot.relationships.map((relationship) => ({
      key: relationship.key,
      fromModel: relationship.fromModel,
      toModel: relationship.toModel,
      binding: relationship.binding,
      condition: relationship.condition
    }));
    const metricBindings = snapshot.metrics.map((metric) => ({
      key: metric.key,
      model: metric.model,
      binding: metric.binding,
      aggregation: metric.aggregation,
      expression: metric.expression
    }));
    const calculatedFieldBindings = calculatedFields.map(
      (calculatedField) => ({
        key: calculatedField.key,
        model: calculatedField.model,
        binding: calculatedField.binding,
        dataType: calculatedField.dataType,
        expression: calculatedField.expression
      })
    );

    const semanticBindings = {
      models: this.toRecord(snapshot.models),
      relationships: this.toRecord(snapshot.relationships),
      metrics: this.toRecord(snapshot.metrics),
      calculatedFields: this.toRecord(calculatedFields)
    };

    const matchedObjectKeys = [
      ...snapshot.models.map((model) => model.key),
      ...snapshot.relationships.map((relationship) => relationship.key),
      ...snapshot.metrics.map((metric) => metric.key),
      ...calculatedFields.map((field) => field.key)
    ];

    const requiredSections: Array<keyof SemanticSpineSnapshotDocument> = [
      "models",
      "relationships",
      "metrics",
      "calculatedFields"
    ];
    const missingObjectKeys = requiredSections.filter((section) => {
      const value =
        section === "calculatedFields"
          ? calculatedFields
          : snapshot[section];
      return !Array.isArray(value) || value.length === 0;
    });
    const sectionCompleteness =
      1 - missingObjectKeys.length / requiredSections.length;

    return {
      status: "ready",
      semanticVersion: meta.semanticVersion,
      semanticBindings,
      instructionSets: {
        modelBindings,
        relationshipBindings,
        metricBindings,
        calculatedFieldBindings
      },
      confidence: {
        score: Number(sectionCompleteness.toFixed(2)),
        degraded: missingObjectKeys.length > 0
      },
      riskTags: this.withModelingRevisionRiskTag(meta.riskTags, meta.modelingRevision),
      evidence: {
        matchedDomain: meta.matchedDomain,
        matchedScope: meta.matchedScope,
        matchedObjectKeys,
        missingObjectKeys,
        modelingRevision: meta.modelingRevision
      }
    };
  }

  private toRecord<
    T extends { key: string }
  >(values: T[]): Record<string, T> {
    return values.reduce<Record<string, T>>((acc, value) => {
      acc[value.key] = value;
      return acc;
    }, {});
  }

  private withModelingRevisionRiskTag(
    riskTags: string[],
    modelingRevision?: number
  ): string[] {
    const normalized = [...riskTags];
    if (modelingRevision === undefined) {
      normalized.push(MODELING_REVISION_MISSING_RISK_TAG);
    }
    return Array.from(new Set(normalized));
  }

  private resolveModelingRevision(
    inputModelingRevision?: number,
    snapshot?: SemanticSpineSnapshotDocument
  ): number | undefined {
    const explicit = this.readPositiveInteger(inputModelingRevision);
    if (explicit !== undefined) {
      return explicit;
    }
    if (!snapshot) {
      return undefined;
    }
    const snapshotWithCompat = snapshot as SemanticSpineSnapshotDocument & {
      modelingRevision?: unknown;
      modeling_revision?: unknown;
      activeRevision?: unknown;
      active_revision?: unknown;
    };
    const topLevelRevisionCandidates = [
      snapshotWithCompat.modelingRevision,
      snapshotWithCompat.modeling_revision,
      snapshotWithCompat.activeRevision,
      snapshotWithCompat.active_revision
    ];
    for (const candidate of topLevelRevisionCandidates) {
      const revision = this.readPositiveInteger(candidate);
      if (revision !== undefined) {
        return revision;
      }
    }
    const metadata =
      snapshot.metadata && typeof snapshot.metadata === "object"
        ? snapshot.metadata
        : undefined;
    if (!metadata) {
      return undefined;
    }
    const revisionCandidates = [
      metadata.modelingRevision,
      metadata.modeling_revision,
      metadata.activeRevision,
      metadata.active_revision
    ];
    for (const candidate of revisionCandidates) {
      const revision = this.readPositiveInteger(candidate);
      if (revision !== undefined) {
        return revision;
      }
    }
    return undefined;
  }

  private readCalculatedFields(
    snapshot: SemanticSpineSnapshotDocument
  ): SemanticSpineCalculatedFieldDefinition[] {
    if (
      Array.isArray(snapshot.calculatedFields) &&
      snapshot.calculatedFields.length > 0
    ) {
      return snapshot.calculatedFields;
    }
    if (
      Array.isArray(snapshot.calculated_fields) &&
      snapshot.calculated_fields.length > 0
    ) {
      return snapshot.calculated_fields;
    }
    return [];
  }

  private readPositiveInteger(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    return undefined;
  }
}
