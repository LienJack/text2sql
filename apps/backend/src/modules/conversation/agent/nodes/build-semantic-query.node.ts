import { Injectable } from "@nestjs/common";
import type { IntentPlan } from "./build-intent-plan.node";
import type { RetrievedKnowledge } from "./retrieve-knowledge.node";
import { PlannerVersionLockService } from "../planner/planner-version-lock.service";

type RagRetrievalBundle = NonNullable<RetrievedKnowledge["retrievalBundle"]>;

export interface SemanticQueryPlan {
  status: "ready" | "degraded";
  semanticHints: string[];
  modelingRevision?: number;
  semanticBindingSummary?: {
    modelBindingCount: number;
    relationshipBindingCount: number;
    metricBindingCount: number;
    calculatedFieldBindingCount: number;
    contextPackStatus?: "ready" | "degraded";
    modelingRevision?: number;
  };
  semanticVersion?: number;
  lockStatus: "locked" | "fallback" | "degraded";
  fallbackApplied: boolean;
  degradeReason?: string;
  riskTags: string[];
  summary: string;
}

@Injectable()
export class BuildSemanticQueryNode {
  constructor(private readonly plannerVersionLock: PlannerVersionLockService) {}

  async run(input: {
    intentPlan: IntentPlan;
    question: string;
    retrievalBundle?: RagRetrievalBundle;
    requestedSemanticVersion?: number;
  }): Promise<SemanticQueryPlan> {
    const { intentPlan } = input;
    if (intentPlan.status === "degraded") {
      return {
        status: "degraded",
        semanticHints: [],
        lockStatus: "degraded",
        fallbackApplied: false,
        riskTags: [],
        summary: "意图规划不可用，语义检索降级。"
      };
    }

    const versionLock = await this.plannerVersionLock.resolve({
      question: input.question,
      retrievalBundle: input.retrievalBundle,
      requestedSemanticVersion: input.requestedSemanticVersion
    });
    const contextPack = this.readContextPack(input.retrievalBundle);
    const contextPackRecord = contextPack as Record<string, unknown> | undefined;
    const modelingRevision = this.readModelingRevision(contextPackRecord);
    const instructionSets = this.readInstructionSets(contextPackRecord);
    const modelBindingCount = instructionSets.modelBindings.length;
    const relationshipBindingCount = instructionSets.relationshipBindings.length;
    const metricBindingCount = instructionSets.metricBindings.length;
    const calculatedFieldBindingCount = instructionSets.calculatedFieldBindings.length;
    const contextPackStatus = this.readContextPackStatus(contextPackRecord);
    const contextualRiskTags = this.buildContextualRiskTags({
      relationshipBindingCount,
      modelingRevision,
      contextPackStatus
    });
    const riskTags = this.unique([...versionLock.riskTags, ...contextualRiskTags]);

    const semanticHints =
      intentPlan.intent === "aggregate"
        ? ["use_metric_aliases", "prefer_dimension_filters"]
        : intentPlan.intent === "compare"
          ? ["normalize_time_window", "keep_metric_consistency"]
          : ["prefer_direct_lookup"];
    if (intentPlan.constraints.includes("must_use_selected_context")) {
      semanticHints.push("must_consume_selected_context");
    }
    if (metricBindingCount > 0) {
      semanticHints.push("prefer_structured_metric_bindings");
    }
    if (relationshipBindingCount > 0) {
      semanticHints.push("prefer_structured_relationship_bindings");
      semanticHints.push(
        modelingRevision === undefined
          ? "relationship_retry_revision_unpinned"
          : "relationship_retry_revision_pinned"
      );
    }
    semanticHints.push(
      modelingRevision === undefined
        ? "modeling_revision_context_missing"
        : "modeling_revision_context_available"
    );
    if (contextPackStatus === "degraded") {
      semanticHints.push("semantic_context_pack_degraded");
    }

    const semanticBindingSummary = contextPack
      ? {
          modelBindingCount,
          relationshipBindingCount,
          metricBindingCount,
          calculatedFieldBindingCount,
          contextPackStatus,
          modelingRevision
        }
      : undefined;

    if (versionLock.lockStatus === "degraded") {
      const summary = `语义版本锁降级：${
        versionLock.degradeReason ?? "unknown"
      }${this.buildRevisionSummarySuffix(
        modelingRevision,
        relationshipBindingCount,
        contextPackStatus
      )}`;
      return {
        status: "degraded",
        semanticHints,
        modelingRevision,
        semanticBindingSummary,
        semanticVersion: versionLock.semanticVersion,
        lockStatus: "degraded",
        fallbackApplied: false,
        degradeReason: versionLock.degradeReason,
        riskTags,
        summary
      };
    }

    if (versionLock.lockStatus === "fallback") {
      const summary = `语义版本不存在，已回退到最近稳定版本并标记降级路径。${this.buildRevisionSummarySuffix(
        modelingRevision,
        relationshipBindingCount,
        contextPackStatus
      )}`;
      return {
        status: "degraded",
        semanticHints,
        modelingRevision,
        semanticBindingSummary,
        semanticVersion: versionLock.semanticVersion,
        lockStatus: "fallback",
        fallbackApplied: true,
        degradeReason: versionLock.degradeReason,
        riskTags,
        summary
      };
    }

    const summary = `已生成语义检索提示并完成版本锁定。${this.buildRevisionSummarySuffix(
      modelingRevision,
      relationshipBindingCount,
      contextPackStatus
    )}`;
    return {
      status: "ready",
      semanticHints,
      modelingRevision,
      semanticBindingSummary,
      semanticVersion: versionLock.semanticVersion,
      lockStatus: "locked",
      fallbackApplied: false,
      riskTags,
      summary
    };
  }

  private buildRevisionSummarySuffix(
    modelingRevision: number | undefined,
    relationshipBindingCount: number,
    contextPackStatus?: "ready" | "degraded"
  ): string {
    const revisionText =
      modelingRevision === undefined ? "missing" : String(modelingRevision);
    const statusText = contextPackStatus ?? "unknown";
    return `（modelingRevision=${revisionText}, relationshipBindings=${relationshipBindingCount}, contextPackStatus=${statusText}）`;
  }

  private readContextPack(
    retrievalBundle: RagRetrievalBundle | undefined
  ): Record<string, unknown> | undefined {
    if (!retrievalBundle) {
      return undefined;
    }
    const bundleWithCompat = retrievalBundle as RagRetrievalBundle & {
      contextPack?: unknown;
    };
    const rawContextPack =
      bundleWithCompat.context_pack ?? bundleWithCompat.contextPack;
    if (
      typeof rawContextPack !== "object" ||
      rawContextPack === null ||
      Array.isArray(rawContextPack)
    ) {
      return undefined;
    }
    return rawContextPack as Record<string, unknown>;
  }

  private readModelingRevision(
    contextPackRecord: Record<string, unknown> | undefined
  ): number | undefined {
    if (!contextPackRecord) {
      return undefined;
    }
    return this.readPositiveInteger(
      contextPackRecord.modelingRevision ??
        contextPackRecord.modeling_revision ??
        contextPackRecord.activeRevision ??
        contextPackRecord.active_revision
    );
  }

  private readInstructionSets(
    contextPackRecord: Record<string, unknown> | undefined
  ): {
    modelBindings: string[];
    relationshipBindings: string[];
    metricBindings: string[];
    calculatedFieldBindings: string[];
  } {
    if (!contextPackRecord) {
      return {
        modelBindings: [],
        relationshipBindings: [],
        metricBindings: [],
        calculatedFieldBindings: []
      };
    }
    const rawInstructionSets =
      (typeof contextPackRecord.instruction_sets === "object" &&
      contextPackRecord.instruction_sets !== null &&
      !Array.isArray(contextPackRecord.instruction_sets)
        ? contextPackRecord.instruction_sets
        : undefined) ??
      (typeof contextPackRecord.instructionSets === "object" &&
      contextPackRecord.instructionSets !== null &&
      !Array.isArray(contextPackRecord.instructionSets)
        ? contextPackRecord.instructionSets
        : undefined);
    if (!rawInstructionSets) {
      return {
        modelBindings: [],
        relationshipBindings: [],
        metricBindings: [],
        calculatedFieldBindings: []
      };
    }
    const instructionSets = rawInstructionSets as Record<string, unknown>;
    return {
      modelBindings: this.readBindingArray(
        instructionSets.model_bindings ?? instructionSets.modelBindings
      ),
      relationshipBindings: this.readBindingArray(
        instructionSets.relationship_bindings ?? instructionSets.relationshipBindings
      ),
      metricBindings: this.readBindingArray(
        instructionSets.metric_bindings ?? instructionSets.metricBindings
      ),
      calculatedFieldBindings: this.readBindingArray(
        instructionSets.calculated_field_bindings ??
          instructionSets.calculatedFieldBindings
      )
    };
  }

  private readContextPackStatus(
    contextPackRecord: Record<string, unknown> | undefined
  ): "ready" | "degraded" | undefined {
    const status =
      contextPackRecord?.status ??
      contextPackRecord?.contextPackStatus ??
      contextPackRecord?.context_pack_status;
    return status === "ready" || status === "degraded" ? status : undefined;
  }

  private buildContextualRiskTags(input: {
    relationshipBindingCount: number;
    modelingRevision: number | undefined;
    contextPackStatus: "ready" | "degraded" | undefined;
  }): string[] {
    const riskTags: string[] = [];
    if (input.relationshipBindingCount > 0 && input.modelingRevision === undefined) {
      riskTags.push("modeling_revision_context_missing");
    }
    if (input.contextPackStatus === "degraded") {
      riskTags.push("semantic_context_pack_degraded");
    }
    return riskTags;
  }

  private readBindingArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.readBindingToken(item))
      .filter((item): item is string => Boolean(item));
  }

  private readBindingToken(value: unknown): string | undefined {
    if (typeof value === "string") {
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : undefined;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const candidates = [
      record.key,
      record.binding,
      record.name,
      record.model,
      record.fromModel
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== "string") {
        continue;
      }
      const normalized = candidate.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
    return undefined;
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

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
  }
}
