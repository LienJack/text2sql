import { Injectable } from "@nestjs/common";
import type {
  SemanticContextPackCapabilityV1,
  SemanticContextPackV1
} from "@text2sql/shared-types";

interface SemanticContextChunkPayload {
  chunk_id: string;
  content?: string;
  metadata?: unknown;
}

interface SemanticContextPermissionFiltering {
  status?: "applied" | "skipped";
  denied_evidence_ids?: string[];
  denied_table_names?: string[];
  denied_column_names?: string[];
  reason_codes?: string[];
  deniedEvidenceIds?: string[];
  deniedTableNames?: string[];
  deniedColumnNames?: string[];
  reasonCodes?: string[];
}

interface SemanticContextLaneMetadata {
  lane?: string;
  state?: string;
  unavailable_reason?: string;
  fallback_reason?: string;
  evidence_ids?: string[];
  reason_codes?: string[];
  input_count?: number;
  output_count?: number;
  selected_count?: number;
  unavailableReason?: string;
  fallbackReason?: string;
  evidenceIds?: string[];
  reasonCodes?: string[];
  inputCount?: number;
  outputCount?: number;
  selectedCount?: number;
}

interface SemanticContextPruningDecision {
  budget_source?: string;
  budgetSource?: string;
  kept_evidence_ids?: string[];
  keptEvidenceIds?: string[];
  removed_evidence_ids?: string[];
  removedEvidenceIds?: string[];
  reason_codes?: string[];
  reasonCodes?: string[];
  summary?: string;
}

interface SemanticContextSemanticBindings {
  model_keys?: string[];
  relationship_keys?: string[];
  metric_keys?: string[];
  calculated_field_keys?: string[];
  modelKeys?: string[];
  relationshipKeys?: string[];
  metricKeys?: string[];
  calculatedFieldKeys?: string[];
}

interface SemanticContextInstructionSets {
  model_bindings?: string[];
  relationship_bindings?: string[];
  metric_bindings?: string[];
  calculated_field_bindings?: string[];
  modelBindings?: string[];
  relationshipBindings?: string[];
  metricBindings?: string[];
  calculatedFieldBindings?: string[];
}

interface SemanticContextRetrievalBundle {
  status?: "ready" | "degraded";
  selected_context?: SemanticContextChunkPayload[];
  degrade_reasons?: string[];
  degradeReasons?: string[];
  permission_filtering?: SemanticContextPermissionFiltering;
  permissionFiltering?: SemanticContextPermissionFiltering;
  lane_results?: Record<
    string,
    {
      status?: "ok" | "degraded";
      degrade_reason?: string;
    }
  >;
  rerank_metadata?: {
    secondary?: {
      status?: "ok" | "degraded" | "skipped";
      unavailable_reason?: string;
      fallback_reason?: string;
    };
  };
  context_pack?: {
    semantic_version?: number;
    semanticVersion?: number;
    modeling_revision?: number;
    modelingRevision?: number;
    semantic_lock_status?: "locked" | "fallback" | "degraded";
    semanticLockStatus?: "locked" | "fallback" | "degraded";
    selected_context_lanes?: string[];
    selectedContextLanes?: string[];
    risk_tags?: string[];
    riskTags?: string[];
    semantic_bindings?: SemanticContextSemanticBindings;
    semanticBindings?: SemanticContextSemanticBindings;
    instruction_sets?: SemanticContextInstructionSets;
    instructionSets?: SemanticContextInstructionSets;
    lane_metadata?: SemanticContextLaneMetadata[];
    laneMetadata?: SemanticContextLaneMetadata[];
    pruning_decisions?: SemanticContextPruningDecision[];
    pruningDecisions?: SemanticContextPruningDecision[];
    permission_filtering?: SemanticContextPermissionFiltering;
    permissionFiltering?: SemanticContextPermissionFiltering;
  };
}

interface BuildSemanticContextPackInput {
  retrievalBundle?: SemanticContextRetrievalBundle;
  selectedContext?: SemanticContextChunkPayload[];
  additionalWarnings?: string[];
}

const MAX_SELECTED_EVIDENCE_IDS = 64;
const MAX_SUMMARY_EVIDENCE_IDS = 24;

@Injectable()
export class SemanticContextPackService {
  build(input: BuildSemanticContextPackInput): SemanticContextPackV1 {
    const selectedContext =
      input.selectedContext ?? input.retrievalBundle?.selected_context ?? [];
    const laneMetadata = this.readLaneMetadata(input.retrievalBundle);
    const pruningDecisions = this.readPruningDecisions(input.retrievalBundle);
    const permissionFiltering = this.readPermissionFiltering(input.retrievalBundle);

    const selectedEvidenceIds = this.unique([
      ...selectedContext.map((chunk) => chunk.chunk_id),
      ...laneMetadata.flatMap((lane) => this.readEvidenceIds(lane)),
      ...pruningDecisions.flatMap((decision) => this.readKeptEvidenceIds(decision))
    ]).slice(0, MAX_SELECTED_EVIDENCE_IDS);

    const semanticBindings = this.readSemanticBindings(input.retrievalBundle);
    const instructionSets = this.readInstructionSets(input.retrievalBundle);

    const selectedTables = this.unique(
      [
        ...selectedContext.flatMap((chunk) =>
          this.readMetadataStringArray(chunk.metadata, "tableNames")
        ),
        ...(semanticBindings.model_keys ?? semanticBindings.modelKeys ?? [])
      ]
        .map((value) => this.normalizeIdentifier(value))
        .filter((value): value is string => Boolean(value))
    );

    const selectedColumns = this.unique(
      selectedContext
        .flatMap((chunk) => this.readMetadataStringArray(chunk.metadata, "columnNames"))
        .map((value) => this.normalizeIdentifier(value))
        .filter((value): value is string => Boolean(value))
    );

    const aliasIds = this.unique(
      selectedContext
        .flatMap((chunk) => [
          ...this.readMetadataStringArray(chunk.metadata, "aliases"),
          ...this.readMetadataStringArray(chunk.metadata, "aliasNames")
        ])
        .map((value) => this.normalizeIdentifier(value))
        .filter((value): value is string => Boolean(value))
    );

    const denseUnavailableWarning = this.resolveDenseUnavailableWarning(input.retrievalBundle);
    const rerankUnavailableWarning = this.resolveRerankUnavailableWarning(input.retrievalBundle);
    const laneWarnings = laneMetadata.flatMap((lane) => this.toLaneWarnings(lane));
    const pruningWarnings = pruningDecisions.flatMap((decision) =>
      this.toPruningWarnings(decision)
    );
    const permissionWarnings = this.toPermissionWarnings(permissionFiltering);
    const semanticVersion = this.readSemanticVersion(input.retrievalBundle?.context_pack);

    const warnings = this.unique([
      ...(input.retrievalBundle?.degrade_reasons ?? []),
      ...(input.retrievalBundle?.degradeReasons ?? []),
      ...(semanticVersion !== undefined
        ? [`context_pack_semantic_version:${semanticVersion}`]
        : []),
      ...(denseUnavailableWarning ? [denseUnavailableWarning] : []),
      ...(rerankUnavailableWarning ? [rerankUnavailableWarning] : []),
      ...laneWarnings,
      ...pruningWarnings,
      ...permissionWarnings,
      ...(input.additionalWarnings ?? [])
    ]);

    const status =
      input.retrievalBundle?.status ??
      (selectedContext.length > 0 ? "ready" : "degraded");

    const selectedContextLanes = this.unique(
      input.retrievalBundle?.context_pack?.selected_context_lanes ??
        input.retrievalBundle?.context_pack?.selectedContextLanes ??
        []
    );

    const laneStates = laneMetadata
      .map((lane) => this.toLaneState(lane))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const degradation = this.buildDegradation({
      status,
      laneStates,
      warnings,
      bundle: input.retrievalBundle,
      riskTags: this.unique(
        input.retrievalBundle?.context_pack?.risk_tags ??
          input.retrievalBundle?.context_pack?.riskTags ??
          []
      )
    });

    const pruning = this.buildPruning(pruningDecisions);
    const permissionFilteringSummary = this.buildPermissionFiltering(permissionFiltering);
    const modelingRevision = this.readModelingRevision(input.retrievalBundle?.context_pack);
    const semanticLockStatus = this.readSemanticLockStatus(
      input.retrievalBundle?.context_pack
    );
    const capabilities = this.buildCapabilities({
      laneStates,
      degradation,
      pruning,
      permissionFiltering: permissionFilteringSummary,
      semanticBindings,
      selectedContextCount: selectedContext.length
    });

    const lanes = this.buildStructuredLanes({
      selectedTables,
      selectedColumns,
      aliasIds,
      laneMetadata,
      semanticBindings,
      instructionSets
    });

    return {
      status,
      selectedEvidenceIds,
      selectedTables,
      selectedColumns,
      ...(warnings.length > 0 ? { warnings } : {}),
      version: "v1.rich",
      capabilities,
      ...(semanticVersion !== undefined ? { semanticVersion } : {}),
      ...(modelingRevision !== undefined ? { modelingRevision } : {}),
      ...(semanticLockStatus ? { semanticLockStatus } : {}),
      selectedContextSummary: {
        count: selectedContext.length,
        evidenceIds: selectedEvidenceIds.slice(0, MAX_SUMMARY_EVIDENCE_IDS),
        ...(selectedContextLanes.length > 0 ? { laneNames: selectedContextLanes } : {})
      },
      lanes,
      ...(laneStates.length > 0 ? { laneStates } : {}),
      degradation,
      pruning,
      permissionFiltering: permissionFilteringSummary
    };
  }

  private buildCapabilities(input: {
    laneStates: NonNullable<SemanticContextPackV1["laneStates"]>;
    degradation: NonNullable<SemanticContextPackV1["degradation"]>;
    pruning: NonNullable<SemanticContextPackV1["pruning"]>;
    permissionFiltering: NonNullable<SemanticContextPackV1["permissionFiltering"]>;
    semanticBindings: SemanticContextSemanticBindings;
    selectedContextCount: number;
  }): SemanticContextPackCapabilityV1[] {
    const capabilities: SemanticContextPackCapabilityV1[] = [
      "selected_context_summary"
    ];

    const hasSemanticBindingRefs =
      (input.semanticBindings.model_keys?.length ?? 0) > 0 ||
      (input.semanticBindings.modelKeys?.length ?? 0) > 0 ||
      (input.semanticBindings.relationship_keys?.length ?? 0) > 0 ||
      (input.semanticBindings.relationshipKeys?.length ?? 0) > 0 ||
      (input.semanticBindings.metric_keys?.length ?? 0) > 0 ||
      (input.semanticBindings.metricKeys?.length ?? 0) > 0 ||
      (input.semanticBindings.calculated_field_keys?.length ?? 0) > 0 ||
      (input.semanticBindings.calculatedFieldKeys?.length ?? 0) > 0;

    if (hasSemanticBindingRefs) {
      capabilities.push("semantic_binding_refs");
    }

    if (input.selectedContextCount > 0 || input.laneStates.length > 0) {
      capabilities.push("structured_lanes");
    }

    if (
      input.degradation.status === "degraded" ||
      input.degradation.reasons.length > 0 ||
      (input.degradation.laneIssues?.length ?? 0) > 0
    ) {
      capabilities.push("structured_degradation");
    }

    if (input.pruning.applied || input.pruning.decisions.length > 0) {
      capabilities.push("structured_pruning");
    }

    if (input.permissionFiltering.status === "applied") {
      capabilities.push("structured_permission_filtering");
    }

    return this.unique(capabilities);
  }

  private buildStructuredLanes(input: {
    selectedTables: string[];
    selectedColumns: string[];
    aliasIds: string[];
    laneMetadata: SemanticContextLaneMetadata[];
    semanticBindings: SemanticContextSemanticBindings;
    instructionSets: SemanticContextInstructionSets;
  }): NonNullable<SemanticContextPackV1["lanes"]> {
    const relationshipRefs = this.unique([
      ...(input.semanticBindings.relationship_keys ??
        input.semanticBindings.relationshipKeys ??
        []),
      ...this.collectLaneRefs(input.laneMetadata, ["relationship"])
    ]);
    const metricRefs = this.unique([
      ...(input.semanticBindings.metric_keys ?? input.semanticBindings.metricKeys ?? []),
      ...this.collectLaneRefs(input.laneMetadata, ["metric"])
    ]);
    const calculatedFieldRefs = this.unique([
      ...(input.semanticBindings.calculated_field_keys ??
        input.semanticBindings.calculatedFieldKeys ??
        []),
      ...this.collectLaneRefs(input.laneMetadata, ["calculated_field", "calculatedField"])
    ]);
    const exampleRefs = this.collectLaneRefs(input.laneMetadata, ["example_sql"]);
    const instructionRefs = this.unique([
      ...this.collectLaneRefs(input.laneMetadata, ["instruction"]),
      ...(input.instructionSets.model_bindings ?? input.instructionSets.modelBindings ?? []),
      ...(input.instructionSets.relationship_bindings ??
        input.instructionSets.relationshipBindings ??
        []),
      ...(input.instructionSets.metric_bindings ?? input.instructionSets.metricBindings ?? []),
      ...(input.instructionSets.calculated_field_bindings ??
        input.instructionSets.calculatedFieldBindings ??
        [])
    ]);
    const priorSqlRefs = this.collectLaneRefs(input.laneMetadata, ["saved_prior_sql"]);
    const schemaSupplementRefs = this.collectLaneRefs(input.laneMetadata, [
      "schema_ddl_supplement",
      "ddl_supplement"
    ]);
    const dialectFunctionRefs = this.collectLaneRefs(input.laneMetadata, ["dialect_function"]);

    return {
      tables: {
        ids: input.selectedTables,
        count: input.selectedTables.length
      },
      columns: {
        ids: input.selectedColumns,
        count: input.selectedColumns.length
      },
      ...(input.aliasIds.length > 0
        ? {
            aliases: {
              ids: input.aliasIds,
              count: input.aliasIds.length
            }
          }
        : {}),
      relationships: {
        refs: relationshipRefs,
        count: relationshipRefs.length
      },
      metrics: {
        refs: metricRefs,
        count: metricRefs.length
      },
      ...(calculatedFieldRefs.length > 0
        ? {
            calculatedFields: {
              refs: calculatedFieldRefs,
              count: calculatedFieldRefs.length
            }
          }
        : {}),
      ...(exampleRefs.length > 0
        ? {
            examples: {
              refs: exampleRefs,
              count: exampleRefs.length
            }
          }
        : {}),
      ...(instructionRefs.length > 0
        ? {
            instructions: {
              refs: instructionRefs,
              count: instructionRefs.length
            }
          }
        : {}),
      ...(priorSqlRefs.length > 0
        ? {
            priorSql: {
              refs: priorSqlRefs,
              count: priorSqlRefs.length
            }
          }
        : {}),
      ...(schemaSupplementRefs.length > 0
        ? {
            schemaSupplementRefs: {
              refs: schemaSupplementRefs,
              count: schemaSupplementRefs.length
            }
          }
        : {}),
      ...(dialectFunctionRefs.length > 0
        ? {
            dialectFunctions: {
              refs: dialectFunctionRefs,
              count: dialectFunctionRefs.length
            }
          }
        : {}),
      semanticBindings: {
        ...(this.unique(
          input.semanticBindings.model_keys ?? input.semanticBindings.modelKeys ?? []
        ).length > 0
          ? {
              modelKeys: this.unique(
                input.semanticBindings.model_keys ?? input.semanticBindings.modelKeys ?? []
              )
            }
          : {}),
        ...(this.unique(
          input.semanticBindings.relationship_keys ??
            input.semanticBindings.relationshipKeys ??
            []
        ).length > 0
          ? {
              relationshipKeys: this.unique(
                input.semanticBindings.relationship_keys ??
                  input.semanticBindings.relationshipKeys ??
                  []
              )
            }
          : {}),
        ...(this.unique(
          input.semanticBindings.metric_keys ?? input.semanticBindings.metricKeys ?? []
        ).length > 0
          ? {
              metricKeys: this.unique(
                input.semanticBindings.metric_keys ?? input.semanticBindings.metricKeys ?? []
              )
            }
          : {}),
        ...(this.unique(
          input.semanticBindings.calculated_field_keys ??
            input.semanticBindings.calculatedFieldKeys ??
            []
        ).length > 0
          ? {
              calculatedFieldKeys: this.unique(
                input.semanticBindings.calculated_field_keys ??
                  input.semanticBindings.calculatedFieldKeys ??
                  []
              )
            }
          : {})
      }
    };
  }

  private buildDegradation(input: {
    status: "ready" | "degraded";
    laneStates: NonNullable<SemanticContextPackV1["laneStates"]>;
    warnings: string[];
    bundle: SemanticContextRetrievalBundle | undefined;
    riskTags: string[];
  }): NonNullable<SemanticContextPackV1["degradation"]> {
    const reasons = this.unique([
      ...(input.bundle?.degrade_reasons ?? []),
      ...(input.bundle?.degradeReasons ?? [])
    ]);

    return {
      status: input.status,
      reasons,
      ...(input.riskTags.length > 0 ? { riskTags: input.riskTags } : {}),
      ...(this.resolveDenseUnavailableWarning(input.bundle)
        ? {
            denseUnavailableReason: this.resolveDenseUnavailableWarning(input.bundle)
          }
        : {}),
      ...(this.resolveRerankUnavailableWarning(input.bundle)
        ? {
            rerankUnavailableReason: this.resolveRerankUnavailableWarning(input.bundle)
          }
        : {}),
      ...(input.laneStates.filter((lane) => lane.state !== "ready").length > 0
        ? {
            laneIssues: input.laneStates.filter((lane) => lane.state !== "ready")
          }
        : {}),
      ...(input.status === "degraded" && reasons.length === 0 && input.warnings.length > 0
        ? {
            reasons: ["context_pack_degraded_without_explicit_reason"]
          }
        : {})
    };
  }

  private buildPruning(
    decisions: SemanticContextPruningDecision[]
  ): NonNullable<SemanticContextPackV1["pruning"]> {
    const normalized = decisions.map((decision) => {
      const keptEvidenceIds = this.readKeptEvidenceIds(decision);
      const removedEvidenceIds = this.readRemovedEvidenceIds(decision);
      const reasonCodes = this.unique(
        decision.reason_codes ?? decision.reasonCodes ?? []
      );

      return {
        budgetSource: decision.budget_source ?? decision.budgetSource,
        keptEvidenceIds,
        removedEvidenceIds,
        keptCount: keptEvidenceIds.length,
        removedCount: removedEvidenceIds.length,
        ...(reasonCodes.length > 0 ? { reasonCodes } : {}),
        ...(this.readString(decision.summary)
          ? { summary: this.readString(decision.summary) }
          : {})
      };
    });

    return {
      applied: normalized.length > 0,
      decisions: normalized
    };
  }

  private buildPermissionFiltering(
    permissionFiltering: SemanticContextPermissionFiltering | undefined
  ): NonNullable<SemanticContextPackV1["permissionFiltering"]> {
    const deniedEvidenceIds = this.unique(
      permissionFiltering?.denied_evidence_ids ??
        permissionFiltering?.deniedEvidenceIds ??
        []
    );
    const deniedTables = this.unique(
      permissionFiltering?.denied_table_names ??
        permissionFiltering?.deniedTableNames ??
        []
    );
    const deniedColumns = this.unique(
      permissionFiltering?.denied_column_names ??
        permissionFiltering?.deniedColumnNames ??
        []
    );
    const reasonCodes = this.unique(
      permissionFiltering?.reason_codes ?? permissionFiltering?.reasonCodes ?? []
    );

    return {
      status: permissionFiltering?.status ?? "skipped",
      ...(deniedEvidenceIds.length > 0 ? { deniedEvidenceIds } : {}),
      ...(deniedEvidenceIds.length > 0
        ? { deniedEvidenceCount: deniedEvidenceIds.length }
        : {}),
      ...(deniedTables.length > 0 ? { deniedTables } : {}),
      ...(deniedColumns.length > 0 ? { deniedColumns } : {}),
      ...(reasonCodes.length > 0 ? { reasonCodes } : {})
    };
  }

  private toLaneState(
    lane: SemanticContextLaneMetadata
  ): NonNullable<SemanticContextPackV1["laneStates"]>[number] | undefined {
    const laneName = this.readString(lane.lane);
    if (!laneName) {
      return undefined;
    }
    const state = this.readString(lane.state) ?? "degraded";
    const refs = this.readEvidenceIds(lane);
    const reasonCodes = this.unique(lane.reason_codes ?? lane.reasonCodes ?? []);

    return {
      lane: laneName,
      state,
      ...(refs.length > 0 ? { refs } : {}),
      ...(reasonCodes.length > 0 ? { reasonCodes } : {}),
      ...(this.readString(lane.unavailable_reason ?? lane.unavailableReason)
        ? {
            unavailableReason: this.readString(
              lane.unavailable_reason ?? lane.unavailableReason
            )
          }
        : {}),
      ...(this.readString(lane.fallback_reason ?? lane.fallbackReason)
        ? {
            fallbackReason: this.readString(lane.fallback_reason ?? lane.fallbackReason)
          }
        : {}),
      ...(this.readNumber(lane.input_count ?? lane.inputCount) !== undefined
        ? { inputCount: this.readNumber(lane.input_count ?? lane.inputCount) }
        : {}),
      ...(this.readNumber(lane.output_count ?? lane.outputCount) !== undefined
        ? { outputCount: this.readNumber(lane.output_count ?? lane.outputCount) }
        : {}),
      ...(this.readNumber(lane.selected_count ?? lane.selectedCount) !== undefined
        ? { selectedCount: this.readNumber(lane.selected_count ?? lane.selectedCount) }
        : {})
    };
  }

  private collectLaneRefs(
    laneMetadata: SemanticContextLaneMetadata[],
    laneNames: string[]
  ): string[] {
    const allowedLaneNames = new Set(laneNames.map((name) => name.trim().toLowerCase()));
    return this.unique(
      laneMetadata
        .filter((lane) =>
          allowedLaneNames.has((lane.lane ?? "").trim().toLowerCase())
        )
        .flatMap((lane) => this.readEvidenceIds(lane))
    );
  }

  private readSemanticBindings(
    bundle: SemanticContextRetrievalBundle | undefined
  ): SemanticContextSemanticBindings {
    return (
      bundle?.context_pack?.semantic_bindings ??
      bundle?.context_pack?.semanticBindings ??
      {}
    );
  }

  private readInstructionSets(
    bundle: SemanticContextRetrievalBundle | undefined
  ): SemanticContextInstructionSets {
    return (
      bundle?.context_pack?.instruction_sets ??
      bundle?.context_pack?.instructionSets ??
      {}
    );
  }

  private normalizeIdentifier(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value
      .trim()
      .replace(/^[`"'\[\]]+|[`"'\[\]]+$/g, "")
      .replace(/\s+/g, "");
    if (!normalized) {
      return undefined;
    }
    return normalized.toLowerCase();
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
  }

  private readMetadataStringArray(metadata: unknown, key: string): string[] {
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
      return [];
    }
    const value = (metadata as Record<string, unknown>)[key];
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === "string");
  }

  private resolveDenseUnavailableWarning(
    bundle: SemanticContextRetrievalBundle | undefined
  ): string | undefined {
    const denseDegradeReason = bundle?.lane_results?.dense?.degrade_reason;
    if (!denseDegradeReason) {
      return undefined;
    }
    if (denseDegradeReason.includes("dense_unavailable")) {
      return `dense_unavailable:${denseDegradeReason}`;
    }
    return undefined;
  }

  private resolveRerankUnavailableWarning(
    bundle: SemanticContextRetrievalBundle | undefined
  ): string | undefined {
    const secondary = bundle?.rerank_metadata?.secondary;
    if (!secondary) {
      return undefined;
    }
    if (secondary.unavailable_reason) {
      return `rerank_unavailable:${secondary.unavailable_reason}`;
    }
    if (secondary.status === "degraded" && secondary.fallback_reason) {
      return `rerank_degraded:${secondary.fallback_reason}`;
    }
    return undefined;
  }

  private toLaneWarnings(lane: SemanticContextLaneMetadata): string[] {
    const laneName = lane.lane?.trim();
    if (!laneName) {
      return [];
    }
    const warnings: string[] = [];
    if (lane.state && lane.state !== "ready") {
      warnings.push(`${laneName}_state:${lane.state}`);
    }
    const unavailableReason = lane.unavailable_reason ?? lane.unavailableReason;
    if (lane.state === "unavailable" && unavailableReason) {
      warnings.push(`${laneName}_unavailable:${unavailableReason}`);
    }
    const fallbackReason = lane.fallback_reason ?? lane.fallbackReason;
    if (lane.state === "degraded" && fallbackReason) {
      warnings.push(`${laneName}_degraded:${fallbackReason}`);
    }
    const reasonCodes = lane.reason_codes ?? lane.reasonCodes ?? [];
    for (const code of reasonCodes) {
      if (code.trim().length > 0) {
        warnings.push(`${laneName}_reason:${code}`);
      }
    }
    return warnings;
  }

  private toPruningWarnings(decision: SemanticContextPruningDecision): string[] {
    const budgetSource = (decision.budget_source ?? decision.budgetSource)?.trim();
    const reasonCodes = (decision.reason_codes ?? decision.reasonCodes ?? []).filter(
      (reason) => reason.trim().length > 0
    );
    if (!budgetSource && reasonCodes.length === 0 && !decision.summary) {
      return [];
    }
    const warnings: string[] = [];
    if (decision.summary && decision.summary.trim().length > 0) {
      warnings.push(`pruning_summary:${decision.summary}`);
    }
    for (const reasonCode of reasonCodes) {
      warnings.push(`pruning_${budgetSource ?? "context"}:${reasonCode}`);
    }
    return warnings;
  }

  private toPermissionWarnings(
    permissionFiltering: SemanticContextPermissionFiltering | undefined
  ): string[] {
    if (!permissionFiltering) {
      return [];
    }
    const deniedTables =
      permissionFiltering.denied_table_names ?? permissionFiltering.deniedTableNames ?? [];
    const deniedColumns =
      permissionFiltering.denied_column_names ?? permissionFiltering.deniedColumnNames ?? [];
    const reasonCodes = permissionFiltering.reason_codes ?? permissionFiltering.reasonCodes ?? [];
    const deniedEvidenceIds =
      permissionFiltering.denied_evidence_ids ?? permissionFiltering.deniedEvidenceIds ?? [];
    return this.unique([
      ...(permissionFiltering.status
        ? [`permission_filter_status:${permissionFiltering.status}`]
        : []),
      ...reasonCodes.map((code) => `permission_filter_reason:${code}`),
      ...deniedTables.map((table) => `permission_denied_table:${table}`),
      ...deniedColumns.map((column) => `permission_denied_column:${column}`),
      ...(deniedEvidenceIds.length > 0
        ? [`permission_denied_evidence_count:${deniedEvidenceIds.length}`]
        : [])
    ]);
  }

  private readLaneMetadata(
    bundle: SemanticContextRetrievalBundle | undefined
  ): SemanticContextLaneMetadata[] {
    return bundle?.context_pack?.lane_metadata ?? bundle?.context_pack?.laneMetadata ?? [];
  }

  private readPruningDecisions(
    bundle: SemanticContextRetrievalBundle | undefined
  ): SemanticContextPruningDecision[] {
    return bundle?.context_pack?.pruning_decisions ?? bundle?.context_pack?.pruningDecisions ?? [];
  }

  private readPermissionFiltering(
    bundle: SemanticContextRetrievalBundle | undefined
  ): SemanticContextPermissionFiltering | undefined {
    if (!bundle) {
      return undefined;
    }
    const rootBundle = bundle as SemanticContextRetrievalBundle & {
      permission_filtering?: SemanticContextPermissionFiltering;
      permissionFiltering?: SemanticContextPermissionFiltering;
    };
    return (
      bundle.context_pack?.permission_filtering ??
      bundle.context_pack?.permissionFiltering ??
      rootBundle.permission_filtering ??
      rootBundle.permissionFiltering
    );
  }

  private readEvidenceIds(lane: SemanticContextLaneMetadata): string[] {
    return lane.evidence_ids ?? lane.evidenceIds ?? [];
  }

  private readKeptEvidenceIds(decision: SemanticContextPruningDecision): string[] {
    return decision.kept_evidence_ids ?? decision.keptEvidenceIds ?? [];
  }

  private readRemovedEvidenceIds(decision: SemanticContextPruningDecision): string[] {
    return decision.removed_evidence_ids ?? decision.removedEvidenceIds ?? [];
  }

  private readSemanticVersion(
    contextPack:
      | {
          semantic_version?: number;
          semanticVersion?: number;
        }
      | undefined
  ): number | undefined {
    return contextPack?.semantic_version ?? contextPack?.semanticVersion;
  }

  private readModelingRevision(
    contextPack:
      | {
          modeling_revision?: number;
          modelingRevision?: number;
        }
      | undefined
  ): number | undefined {
    return contextPack?.modeling_revision ?? contextPack?.modelingRevision;
  }

  private readSemanticLockStatus(
    contextPack:
      | {
          semantic_lock_status?: "locked" | "fallback" | "degraded";
          semanticLockStatus?: "locked" | "fallback" | "degraded";
        }
      | undefined
  ): "locked" | "fallback" | "degraded" | undefined {
    return contextPack?.semantic_lock_status ?? contextPack?.semanticLockStatus;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : undefined;
  }
}
