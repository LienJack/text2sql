import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  SqlRun,
  Text2SqlV2ArtifactRefV1,
  Text2SqlV2ArtifactRefCategoryV1
} from "@text2sql/shared-types";
import {
  KNOWLEDGE_FACADE_CONTRACT,
  type KnowledgeFacadeContract
} from "../../knowledge/contracts/knowledge-facade.contract";

const CONTEXT_EVIDENCE_REF_THRESHOLD = 24;
const EXECUTION_PREVIEW_ROW_THRESHOLD = 3;
const EXECUTION_PREVIEW_SIZE_THRESHOLD = 2_048;

export const REQUIRED_TEXT2SQL_V2_ARTIFACT_CATEGORIES = [
  "context_snippets",
  "schema_supplement",
  "prompt_input",
  "provider_output_summary",
  "validation_diagnostics",
  "correction_grounding",
  "execution_preview"
] as const satisfies readonly Text2SqlV2ArtifactRefCategoryV1[];

type ArtifactSensitivity = NonNullable<Text2SqlV2ArtifactRefV1["sensitivity"]>;
type ArtifactVisibility = Text2SqlV2ArtifactRefV1["visibility"];

interface Text2SqlV2ArtifactCategoryPolicy {
  visibility: ArtifactVisibility;
  sensitivity: ArtifactSensitivity;
  allowPayload: boolean;
  reasonCode: string;
}

export const TEXT2SQL_V2_ARTIFACT_CATEGORY_POLICIES: Record<
  (typeof REQUIRED_TEXT2SQL_V2_ARTIFACT_CATEGORIES)[number],
  Text2SqlV2ArtifactCategoryPolicy
> = {
  context_snippets: {
    visibility: "user",
    sensitivity: "none",
    allowPayload: true,
    reasonCode: "large_context_compacted"
  },
  schema_supplement: {
    visibility: "user",
    sensitivity: "permission_filtered",
    allowPayload: false,
    reasonCode: "schema_supplement_summarized"
  },
  prompt_input: {
    visibility: "internal",
    sensitivity: "sensitive",
    allowPayload: false,
    reasonCode: "prompt_input_summarized"
  },
  provider_output_summary: {
    visibility: "internal",
    sensitivity: "provider_raw",
    allowPayload: false,
    reasonCode: "provider_output_summarized"
  },
  validation_diagnostics: {
    visibility: "user",
    sensitivity: "none",
    allowPayload: true,
    reasonCode: "validation_diagnostics_summarized"
  },
  correction_grounding: {
    visibility: "user",
    sensitivity: "none",
    allowPayload: true,
    reasonCode: "correction_grounding_summarized"
  },
  execution_preview: {
    visibility: "user",
    sensitivity: "none",
    allowPayload: true,
    reasonCode: "execution_preview_compacted"
  }
};

export interface Text2SqlV2ArtifactOffloadResult {
  ref?: Text2SqlV2ArtifactRefV1;
  degradationReason?: string;
}

export interface Text2SqlV2ArtifactProducerInput {
  runId: string;
  datasourceId: string;
  category: Text2SqlV2ArtifactRefCategoryV1;
  stableId: string;
  summary: string;
  sizeBytes?: number;
  visibility?: ArtifactVisibility;
  sensitivity?: ArtifactSensitivity;
  evidenceRefs?: string[];
  reasonCodes?: string[];
  payload?: Record<string, unknown>;
}

@Injectable()
export class Text2SqlV2ArtifactRefService {
  constructor(
    @Inject(KNOWLEDGE_FACADE_CONTRACT)
    private readonly knowledgeFacade: KnowledgeFacadeContract
  ) {}

  async attachRunArtifactRefs(run: SqlRun, datasourceId: string): Promise<SqlRun> {
    const refs: Text2SqlV2ArtifactRefV1[] = [
      ...(run.trace.v2?.artifactRefs ?? [])
    ];
    const warnings: string[] = [];
    const existingIds = new Set(refs.map((ref) => ref.id));

    for (const artifactInput of this.buildProducerInputs({ run, datasourceId })) {
      const refId = `artifact:${artifactInput.category}:${artifactInput.stableId}`;
      if (existingIds.has(refId)) {
        continue;
      }
      const result = await this.writeSummaryArtifact(artifactInput);
      if (result.ref) {
        refs.push(result.ref);
        existingIds.add(result.ref.id);
      }
      if (result.degradationReason) {
        warnings.push(result.degradationReason);
      }
    }

    if (refs.length === 0 && warnings.length === 0) {
      return run;
    }

    return {
      ...run,
      trace: {
        ...run.trace,
        v2: run.trace.v2
          ? {
              ...run.trace.v2,
              ...(refs.length > 0 ? { artifactRefs: this.uniqueRefs(refs) } : {}),
              stages: warnings.length > 0
                ? this.appendArtifactWarnings(run.trace.v2.stages, warnings)
                : run.trace.v2.stages
            }
          : run.trace.v2
      }
    };
  }

  async writeSummaryArtifact(
    input: Text2SqlV2ArtifactProducerInput
  ): Promise<Text2SqlV2ArtifactOffloadResult> {
    const policy = this.resolvePolicy(input.category);
    const sensitivity = input.sensitivity ?? policy.sensitivity;
    const visibility = input.visibility ?? policy.visibility;
    const reasonCodes = this.uniqueStrings([
      policy.reasonCode,
      ...(input.reasonCodes ?? [])
    ]);
    const evidenceRefs = this.uniqueStrings(input.evidenceRefs ?? []);
    const payload = this.shouldPersistPayload(policy, sensitivity)
      ? input.payload
      : undefined;
    const hash = this.hash({
      category: input.category,
      stableId: input.stableId,
      summary: input.summary,
      evidenceRefs,
      reasonCodes
    });
    const replayKey = `text2sql:artifact:${input.category}:${input.stableId}`;
    const ref: Text2SqlV2ArtifactRefV1 = {
      id: `artifact:${input.category}:${input.stableId}`,
      category: input.category,
      summary: input.summary,
      hash,
      version: "artifact-ref.v1",
      ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
      replayKeyHint: replayKey,
      visibility,
      sensitivity,
      ...(reasonCodes.length ? { reasonCodes } : {}),
      ...(evidenceRefs.length ? { evidenceRefs } : {})
    };

    try {
      await this.knowledgeFacade.rag.replay.writeReplay({
        runId: input.runId,
        datasourceId: input.datasourceId,
        replayKey,
        stage: "text2sql_artifact_ref",
        payload: {
          version: "text2sql-artifact-summary.v1",
          ref,
          sanitizedSummary: input.summary,
          evidenceRefs,
          reasonCodes,
          sizeBytes: input.sizeBytes,
          createdAt: new Date().toISOString(),
          payload
        }
      });
      return { ref };
    } catch {
      return {
        degradationReason: `artifact_ref_write_failed:${input.category}`
      };
    }
  }

  private buildProducerInputs(input: {
    run: SqlRun;
    datasourceId: string;
  }): Text2SqlV2ArtifactProducerInput[] {
    return [
      this.buildContextPackArtifact(input),
      this.buildSchemaSupplementArtifact(input),
      this.buildPromptInputArtifact(input),
      this.buildProviderOutputArtifact(input),
      this.buildValidationDiagnosticsArtifact(input),
      this.buildCorrectionGroundingArtifact(input),
      this.buildExecutionPreviewArtifact(input)
    ].filter((item): item is Text2SqlV2ArtifactProducerInput => Boolean(item));
  }

  private buildContextPackArtifact(input: {
    run: SqlRun;
    datasourceId: string;
  }): Text2SqlV2ArtifactProducerInput | undefined {
    const contextPack = input.run.trace.v2?.contextPack;
    const selectedEvidenceIds = contextPack?.selectedEvidenceIds ?? [];
    if (selectedEvidenceIds.length <= CONTEXT_EVIDENCE_REF_THRESHOLD) {
      return undefined;
    }

    const stableId = this.stableHashId({
      runId: input.run.runId,
      selectedEvidenceIds
    });

    return {
      runId: input.run.runId,
      datasourceId: input.datasourceId,
      category: "context_snippets",
      stableId,
      summary: `Compacted ${selectedEvidenceIds.length} selected context evidence ids.`,
      sizeBytes: JSON.stringify(contextPack).length,
      visibility: "user",
      sensitivity:
        contextPack?.permissionFiltering?.status === "applied"
          ? "permission_filtered"
          : "none",
      evidenceRefs: selectedEvidenceIds.slice(0, 24),
      reasonCodes: ["large_context_compacted"],
      payload: {
        status: contextPack?.status,
        selectedEvidenceIds,
        selectedTables: contextPack?.selectedTables ?? [],
        selectedColumns: contextPack?.selectedColumns ?? [],
        degradationReasons: contextPack?.degradation?.reasons ?? []
      }
    };
  }

  private buildSchemaSupplementArtifact(input: {
    run: SqlRun;
    datasourceId: string;
  }): Text2SqlV2ArtifactProducerInput | undefined {
    const contextPack = input.run.trace.v2?.contextPack;
    const selectedTables = contextPack?.selectedTables ?? [];
    const selectedColumns = contextPack?.selectedColumns ?? [];
    if (selectedTables.length === 0 && selectedColumns.length === 0) {
      return undefined;
    }
    const evidenceRefs = contextPack?.selectedEvidenceIds ?? [];
    return {
      runId: input.run.runId,
      datasourceId: input.datasourceId,
      category: "schema_supplement",
      stableId: this.stableHashId({
        runId: input.run.runId,
        selectedTables,
        selectedColumns
      }),
      summary: `Schema supplement summarized ${selectedTables.length} tables and ${selectedColumns.length} columns.`,
      sizeBytes: JSON.stringify({ selectedTables, selectedColumns }).length,
      visibility: "user",
      sensitivity:
        contextPack?.permissionFiltering?.status === "applied"
          ? "permission_filtered"
          : "none",
      evidenceRefs: evidenceRefs.slice(0, 24),
      reasonCodes: [
        "schema_supplement_summarized",
        ...(contextPack?.permissionFiltering?.status === "applied"
          ? ["permission_filtered_schema"]
          : [])
      ],
      payload: {
        selectedTables,
        selectedColumns,
        laneStates: contextPack?.laneStates?.map((lane) => ({
          lane: lane.lane,
          state: lane.state,
          reasonCodes: lane.reasonCodes,
          inputCount: lane.inputCount,
          outputCount: lane.outputCount,
          selectedCount: lane.selectedCount
        })),
        pruning: contextPack?.pruning
          ? {
              applied: contextPack.pruning.applied,
              decisions: contextPack.pruning.decisions.map((decision) => ({
                keptCount: decision.keptCount,
                removedCount: decision.removedCount,
                reasonCodes: decision.reasonCodes,
                summary: decision.summary
              }))
            }
          : undefined
      }
    };
  }

  private buildPromptInputArtifact(input: {
    run: SqlRun;
    datasourceId: string;
  }): Text2SqlV2ArtifactProducerInput | undefined {
    const promptTemplate =
      input.run.trace.promptTemplate ??
      this.asRecord(input.run.trace.v2?.sqlGeneration)?.promptTemplate;
    const smartDefaults = input.run.trace.v2?.smartDefaults;
    if (!promptTemplate && !smartDefaults) {
      return undefined;
    }
    const template = this.asRecord(promptTemplate);
    return {
      runId: input.run.runId,
      datasourceId: input.datasourceId,
      category: "prompt_input",
      stableId: this.stableHashId({
        runId: input.run.runId,
        promptTemplate,
        smartDefaults
      }),
      summary: `Prompt input summarized template ${this.readString(template?.templateId) ?? "default"} with Smart Defaults ${smartDefaults?.status ?? "unknown"}.`,
      sizeBytes: JSON.stringify({ promptTemplate, smartDefaults }).length,
      visibility: "internal",
      sensitivity: "sensitive",
      reasonCodes: ["prompt_input_summarized"],
      payload: {
        promptTemplate: {
          templateId: this.readString(template?.templateId),
          version: template?.version,
          source: this.readString(template?.source),
          fallbackReason: this.readString(template?.fallbackReason)
        },
        smartDefaults: smartDefaults
          ? {
              bundleId: smartDefaults.bundleId,
              version: smartDefaults.version,
              coveredStages: smartDefaults.coveredStages,
              ruleIds: smartDefaults.ruleIds,
              status: smartDefaults.status,
              fallbackReason: smartDefaults.fallbackReason,
              templateOverlay: smartDefaults.templateOverlay
            }
          : undefined
      }
    };
  }

  private buildProviderOutputArtifact(input: {
    run: SqlRun;
    datasourceId: string;
  }): Text2SqlV2ArtifactProducerInput | undefined {
    const sqlGeneration = input.run.trace.v2?.sqlGeneration;
    if (!sqlGeneration && !input.run.provider && !input.run.model) {
      return undefined;
    }
    const sql = this.readString(this.asRecord(sqlGeneration)?.sql) ?? input.run.sql;
    return {
      runId: input.run.runId,
      datasourceId: input.datasourceId,
      category: "provider_output_summary",
      stableId: this.stableHashId({
        runId: input.run.runId,
        provider: input.run.provider,
        model: input.run.model,
        sqlHash: sql ? this.hash(sql) : undefined
      }),
      summary: `Provider output summarized for ${input.run.provider}${input.run.model ? `/${input.run.model}` : ""}.`,
      sizeBytes: JSON.stringify({ provider: input.run.provider, model: input.run.model, sql }).length,
      visibility: "internal",
      sensitivity: "provider_raw",
      reasonCodes: ["provider_output_summarized"],
      payload: {
        provider: input.run.provider,
        model: input.run.model,
        sqlHash: sql ? this.hash(sql) : undefined,
        sqlPreview: sql ? sql.slice(0, 160) : undefined
      }
    };
  }

  private buildValidationDiagnosticsArtifact(input: {
    run: SqlRun;
    datasourceId: string;
  }): Text2SqlV2ArtifactProducerInput | undefined {
    const validation = input.run.trace.v2?.sqlValidation;
    const checks = validation?.checks ?? [];
    const notableChecks = checks.filter((check) => check.status !== "passed");
    if (!validation || notableChecks.length === 0) {
      return undefined;
    }
    const reasonCodes = notableChecks
      .map((check) => check.code ?? check.check)
      .filter((item): item is string => Boolean(item));
    return {
      runId: input.run.runId,
      datasourceId: input.datasourceId,
      category: "validation_diagnostics",
      stableId: this.stableHashId({
        runId: input.run.runId,
        checks: notableChecks.map((check) => [check.check, check.status, check.code])
      }),
      summary: `Validation diagnostics summarized ${notableChecks.length} non-passing checks.`,
      sizeBytes: JSON.stringify(validation).length,
      visibility: "user",
      sensitivity: "none",
      reasonCodes: ["validation_diagnostics_summarized", ...reasonCodes],
      payload: {
        status: validation.status,
        correctable: validation.correctable,
        failure: validation.failure
          ? {
              code: validation.failure.code,
              category: validation.failure.category,
              terminal: validation.failure.terminal,
              correctable: validation.failure.correctable
            }
          : undefined,
        checks: notableChecks.map((check) => ({
          check: check.check,
          status: check.status,
          code: check.code,
          message: check.message
        }))
      }
    };
  }

  private buildCorrectionGroundingArtifact(input: {
    run: SqlRun;
    datasourceId: string;
  }): Text2SqlV2ArtifactProducerInput | undefined {
    const sqlGeneration = this.asRecord(input.run.trace.v2?.sqlGeneration);
    const grounding =
      this.asRecord(sqlGeneration?.correctionGrounding) ??
      this.findCorrectionGrounding(input.run);
    if (!grounding) {
      return undefined;
    }
    const evidenceRefs = Array.isArray(grounding.evidenceRefs)
      ? grounding.evidenceRefs.filter((item): item is string => typeof item === "string")
      : [];
    const retryReason = this.readString(grounding.retryReason) ?? "correction_retry";
    const failureCode = this.readString(grounding.failureCode);
    return {
      runId: input.run.runId,
      datasourceId: input.datasourceId,
      category: "correction_grounding",
      stableId: this.stableHashId({
        runId: input.run.runId,
        retryReason,
        failureCode,
        failedSqlRef: this.readString(grounding.failedSqlRef)
      }),
      summary: `Correction grounding summarized retry reason ${retryReason}.`,
      sizeBytes: JSON.stringify(grounding).length,
      visibility: "user",
      sensitivity: "none",
      evidenceRefs,
      reasonCodes: [
        "correction_grounding_summarized",
        ...(failureCode ? [failureCode] : [])
      ],
      payload: {
        failedSqlRef: this.readString(grounding.failedSqlRef),
        failedSqlPreview: this.readString(grounding.failedSqlPreview),
        retryReason,
        failureCode,
        failureCategory: this.readString(grounding.failureCategory),
        attemptCount: grounding.attemptCount,
        maxAttempts: grounding.maxAttempts,
        evidenceRefs
      }
    };
  }

  private buildExecutionPreviewArtifact(input: {
    run: SqlRun;
    datasourceId: string;
  }): Text2SqlV2ArtifactProducerInput | undefined {
    const rows = input.run.rows ?? [];
    const columns = input.run.columns ?? [];
    const previewSize = JSON.stringify({ rows, columns }).length;
    if (
      rows.length <= EXECUTION_PREVIEW_ROW_THRESHOLD &&
      previewSize <= EXECUTION_PREVIEW_SIZE_THRESHOLD
    ) {
      return undefined;
    }
    return {
      runId: input.run.runId,
      datasourceId: input.datasourceId,
      category: "execution_preview",
      stableId: this.stableHashId({
        runId: input.run.runId,
        rowCount: rows.length,
        columns
      }),
      summary: `Execution preview compacted ${rows.length} rows and ${columns.length} columns.`,
      sizeBytes: previewSize,
      visibility: "user",
      sensitivity: "none",
      reasonCodes: ["execution_preview_compacted"],
      payload: {
        rowCount: rows.length,
        columns,
        rowsPreview: rows.slice(0, EXECUTION_PREVIEW_ROW_THRESHOLD)
      }
    };
  }

  private appendArtifactWarnings(
    stages: NonNullable<SqlRun["trace"]["v2"]>["stages"],
    warnings: string[]
  ): NonNullable<SqlRun["trace"]["v2"]>["stages"] {
    return stages.map((stage) =>
      stage.stage === "answer"
        ? {
            ...stage,
            warnings: Array.from(new Set([...(stage.warnings ?? []), ...warnings]))
          }
        : stage
    );
  }

  private uniqueRefs(refs: Text2SqlV2ArtifactRefV1[]): Text2SqlV2ArtifactRefV1[] {
    return Array.from(new Map(refs.map((ref) => [ref.id, ref])).values());
  }

  private resolvePolicy(
    category: Text2SqlV2ArtifactRefCategoryV1
  ): Text2SqlV2ArtifactCategoryPolicy {
    return (
      TEXT2SQL_V2_ARTIFACT_CATEGORY_POLICIES[
        category as (typeof REQUIRED_TEXT2SQL_V2_ARTIFACT_CATEGORIES)[number]
      ] ?? {
        visibility: "internal",
        sensitivity: "sensitive",
        allowPayload: false,
        reasonCode: "artifact_ref_summarized"
      }
    );
  }

  private shouldPersistPayload(
    policy: Text2SqlV2ArtifactCategoryPolicy,
    sensitivity: ArtifactSensitivity
  ): boolean {
    return (
      policy.allowPayload &&
      sensitivity !== "provider_raw" &&
      sensitivity !== "permission_filtered" &&
      sensitivity !== "sensitive"
    );
  }

  private uniqueStrings(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
    );
  }

  private stableHashId(value: unknown): string {
    return this.hash(value).slice("sha256:".length, "sha256:".length + 16);
  }

  private findCorrectionGrounding(run: SqlRun): Record<string, unknown> | undefined {
    for (const stage of run.trace.v2?.stages ?? []) {
      if (stage.stage !== "correct") {
        continue;
      }
      const grounding = this.asRecord(stage.metadata)?.correctionGrounding;
      const record = this.asRecord(grounding);
      if (record) {
        return record;
      }
    }
    return undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0
      ? value
      : undefined;
  }

  private hash(value: unknown): string {
    return `sha256:${createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex")}`;
  }
}
