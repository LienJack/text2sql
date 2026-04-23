import { Injectable } from "@nestjs/common";
import { SemanticSpineRepository } from "./semantic-spine.repository";
import type {
  SemanticSpineCalculatedFieldDefinition,
  SemanticSpineMetricDefinition,
  SemanticSpineModelDefinition,
  SemanticSpineRelationshipDefinition,
  SemanticSpineSnapshotDocument
} from "./semantic-spine.types";

export interface SemanticSpineCompileInput {
  domain: string;
  datasourceId?: string;
  semanticVersion?: number;
}

export interface SemanticSpineCompileEvidence {
  matchedDomain?: string;
  matchedScope?: "datasource" | "global";
  matchedObjectKeys: string[];
  missingObjectKeys: string[];
  degradeReason?: string;
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
        riskTags: resolved.risk_tags ?? [],
        evidence: {
          matchedDomain: resolved.matched_domain,
          matchedScope: resolved.matched_scope,
          matchedObjectKeys: [],
          missingObjectKeys: ["models", "relationships", "metrics", "calculatedFields"],
          degradeReason: resolved.degrade_reason
        }
      };
    }

    return this.buildReadyOutput(resolved.snapshot, {
      semanticVersion: resolved.semantic_version,
      matchedDomain: resolved.matched_domain,
      matchedScope: resolved.matched_scope,
      riskTags: resolved.risk_tags ?? []
    });
  }

  private buildReadyOutput(
    snapshot: SemanticSpineSnapshotDocument,
    meta: {
      semanticVersion?: number;
      matchedDomain?: string;
      matchedScope?: "datasource" | "global";
      riskTags: string[];
    }
  ): SemanticSpineCompileOutput {
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
    const calculatedFieldBindings = (snapshot.calculatedFields ?? []).map(
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
      calculatedFields: this.toRecord(snapshot.calculatedFields ?? [])
    };

    const matchedObjectKeys = [
      ...snapshot.models.map((model) => model.key),
      ...snapshot.relationships.map((relationship) => relationship.key),
      ...snapshot.metrics.map((metric) => metric.key),
      ...(snapshot.calculatedFields ?? []).map((field) => field.key)
    ];

    const requiredSections: Array<keyof SemanticSpineSnapshotDocument> = [
      "models",
      "relationships",
      "metrics",
      "calculatedFields"
    ];
    const missingObjectKeys = requiredSections.filter((section) => {
      const value = snapshot[section];
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
      riskTags: meta.riskTags,
      evidence: {
        matchedDomain: meta.matchedDomain,
        matchedScope: meta.matchedScope,
        matchedObjectKeys,
        missingObjectKeys
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
}
