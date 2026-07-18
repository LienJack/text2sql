import { Injectable } from "@nestjs/common";
import type { DeliveryArtifactLayer, SqlRun } from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { ChartBiGroundingGuard } from "./chartbi-grounding.guard";
import {
  ChartBiIntentParser,
  type ChartBiIntentParseResult,
  type ChartBiVisualIntent
} from "./chartbi-intent-parser";
import {
  type ChartBiCanonicalSpec,
  type ChartBiDisplayType,
  type ChartBiSummaryBlock,
  ChartBiResultProfiler
} from "./chartbi-result-profiler";
import { ChartBiSpecCompiler } from "./chartbi-spec-compiler";
import { ChartBiValidator } from "./chartbi-validator";

export interface ChartBiArtifactBuildInput {
  sql?: string;
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  answer?: string;
  error?: string;
  hasError?: boolean;
  visualIntentRaw?: string | null;
}

export interface ChartBiArtifactLayer extends DeliveryArtifactLayer {
  grounding?: {
    mode: "committed_analysis_refs";
    claimRefs: string[];
    evidenceRefs: string[];
  };
  summary: ChartBiSummaryBlock;
  table: {
    columns: string[];
    rowCount: number;
    rowsPreview: Array<Record<string, unknown>>;
    previewRowCount: number;
    truncated: boolean;
  };
  chart?: DeliveryArtifactLayer["chart"];
  display: ChartBiDisplayType;
  displayModes: ChartBiDisplayType[];
  validation: {
    status: "valid" | "repaired" | "fallback";
    source: "baseline" | "repaired_intent" | "table_fallback";
    reasonCodes?: string[];
    message?: string;
  };
  fallback?: {
    display: "table";
    reason: string;
    reasonCode?: string;
    fromType?: string;
    stage?: "parse" | "compile" | "validate" | "runtime";
  };
  visualIntent: {
    source: "deterministic" | "model" | "hybrid";
    status: "not_provided" | "parsed" | "failed";
    type?: ChartBiDisplayType;
    title?: string;
    summaryHint?: string;
    insight?: string;
    mappings?: Record<string, unknown>;
    rawSyntax?: string;
    normalizedIntent?: Record<string, unknown>;
    reason?: string;
  };
}

@Injectable()
export class ChartBiArtifactService {
  constructor(
    private readonly profiler: ChartBiResultProfiler,
    private readonly intentParser: ChartBiIntentParser,
    private readonly specCompiler: ChartBiSpecCompiler,
    private readonly validator: ChartBiValidator,
    private readonly groundingGuard: ChartBiGroundingGuard
  ) {}

  buildFromRun(
    run: Pick<SqlRun, "sql" | "columns" | "rows" | "answer" | "error" | "llmRaw">,
    options?: {
      visualIntentRaw?: string | null;
    }
  ): ChartBiArtifactLayer {
    return this.build({
      sql: run.sql,
      columns: run.columns,
      rows: run.rows,
      answer: run.answer,
      error: run.error,
      hasError: Boolean(run.error),
      visualIntentRaw: options?.visualIntentRaw ?? run.llmRaw?.rawText
    });
  }

  buildFromCommittedAnalysis(
    input: ChartBiArtifactBuildInput & {
      claimRefs: string[];
      evidenceRefs: string[];
    }
  ): ChartBiArtifactLayer {
    const claimRefs = [...new Set(input.claimRefs)].filter(Boolean).sort();
    const evidenceRefs = [...new Set(input.evidenceRefs)].filter(Boolean).sort();
    if (claimRefs.length === 0 || evidenceRefs.length === 0) {
      throw new DomainError(
        "CHARTBI_ANALYSIS_GROUNDING_REQUIRED",
        "Analysis ChartBI 必须引用 committed Claim 与 Evidence。",
        409
      );
    }
    return {
      ...this.build(input),
      grounding: {
        mode: "committed_analysis_refs",
        claimRefs,
        evidenceRefs
      }
    };
  }

  build(input: ChartBiArtifactBuildInput): ChartBiArtifactLayer {
    const rows = this.cloneRows(input.rows ?? []);
    const columns = this.resolveColumns(input.columns ?? [], rows);
    const profile = this.profiler.profile({
      columns,
      rows
    });
    const parseResult = this.intentParser.parse(input.visualIntentRaw ?? undefined);

    if (input.hasError || input.error) {
      return this.buildFallbackArtifact({
        profile,
        sql: input.sql,
        summary: this.resolveSummaryText(input.answer, profile.summary.text),
        reason: input.error ?? "table fallback: run has error state.",
        stage: "runtime",
        parseResult,
        hasError: true
      });
    }

    const compileResult = this.specCompiler.compile({
      profile,
      parsedIntent: parseResult.status === "parsed" ? parseResult.intent : undefined
    });

    const candidates: Array<{
      source: "baseline" | "repaired_intent";
      spec: ChartBiCanonicalSpec;
    }> = [];

    if (compileResult.baseline) {
      candidates.push({
        source: "baseline",
        spec: compileResult.baseline
      });
    }
    if (compileResult.repairedIntent) {
      candidates.push({
        source: "repaired_intent",
        spec: compileResult.repairedIntent
      });
    }

    const validationFailures: string[] = [];
    for (const candidate of candidates) {
      const validation = this.validator.validate({
        spec: candidate.spec,
        columns: profile.columns,
        rows: profile.rows
      });
      if (!validation.ok) {
        validationFailures.push(
          `${candidate.source}: ${validation.reason ?? "unknown validation failure"}`
        );
        continue;
      }

      const grounded = this.groundingGuard.enforce({
        spec: candidate.spec,
        columns: profile.columns,
        rows: profile.rows
      });

      const groundedSpec: ChartBiCanonicalSpec = {
        ...candidate.spec,
        ...(grounded.insights.length > 0 ? { insights: grounded.insights } : {})
      };

      return this.buildSuccessArtifact({
        profile,
        sql: input.sql,
        summary: this.resolveSummaryText(input.answer, profile.summary.text),
        spec: groundedSpec,
        source: candidate.source,
        parseResult,
        groundingNote: grounded.reason
      });
    }

    const fallbackReason = this.resolveFallbackReason({
      parseResult,
      validationFailures,
      hasBaseline: Boolean(compileResult.baseline),
      rowCount: profile.rowCount
    });

    return this.buildFallbackArtifact({
      profile,
      sql: input.sql,
      summary: this.resolveSummaryText(input.answer, profile.summary.text),
      reason: fallbackReason.reason,
      stage: fallbackReason.stage,
      parseResult,
      hasError: false
    });
  }

  private buildSuccessArtifact(input: {
    profile: ReturnType<ChartBiResultProfiler["profile"]>;
    sql?: string;
    summary: string;
    spec: ChartBiCanonicalSpec;
    source: "baseline" | "repaired_intent";
    parseResult: ChartBiIntentParseResult;
    groundingNote?: string;
  }): ChartBiArtifactLayer {
    const table = this.buildTableBlock(input.profile);
    const displayModes = this.uniqueDisplayTypes(["table", input.spec.type]);
    const chart = this.toDeliveryChart(input.spec);

    return {
      sql: input.sql,
      columns: [...input.profile.columns],
      rowCount: input.profile.rowCount,
      rowsPreview: this.cloneRows(input.profile.previewRows),
      hasError: false,
      summary: {
        text: input.summary,
        ...(input.profile.summary.highlights
          ? {
              dimensions: input.profile.summary.highlights.map((item) => item.label),
              metrics: input.profile.summary.highlights.map((item) => ({
                key: item.label,
                label: item.label,
                value: item.value
              }))
            }
          : {})
      },
      table,
      chart,
      display: input.spec.type,
      displayModes,
      validation: {
        status: input.source === "baseline" ? "valid" : "repaired",
        source: input.source,
        ...(input.groundingNote
          ? {
              reasonCodes: ["grounding_insight_filtered"],
              message: input.groundingNote
            }
          : {})
      },
      visualIntent: this.toVisualIntentMeta(input.parseResult)
    };
  }

  private buildFallbackArtifact(input: {
    profile: ReturnType<ChartBiResultProfiler["profile"]>;
    sql?: string;
    summary: string;
    reason: string;
    stage: "parse" | "compile" | "validate" | "runtime";
    parseResult: ChartBiIntentParseResult;
    hasError: boolean;
  }): ChartBiArtifactLayer {
    return {
      sql: input.sql,
      columns: [...input.profile.columns],
      rowCount: input.profile.rowCount,
      rowsPreview: this.cloneRows(input.profile.previewRows),
      hasError: input.hasError,
      summary: {
        text: input.summary,
        ...(input.profile.summary.highlights
          ? {
              dimensions: input.profile.summary.highlights.map((item) => item.label),
              metrics: input.profile.summary.highlights.map((item) => ({
                key: item.label,
                label: item.label,
                value: item.value
              }))
            }
          : {})
      },
      table: this.buildTableBlock(input.profile),
      display: "table",
      displayModes: ["table"],
      validation: {
        status: "fallback",
        source: "table_fallback",
        reasonCodes: [this.stageToReasonCode(input.stage)],
        message: input.reason
      },
      fallback: {
        display: "table",
        reason: input.reason,
        reasonCode: this.stageToReasonCode(input.stage),
        stage: input.stage
      },
      visualIntent: this.toVisualIntentMeta(input.parseResult)
    };
  }

  private toDeliveryChart(spec: ChartBiCanonicalSpec): NonNullable<ChartBiArtifactLayer["chart"]> {
    return {
      type: spec.type,
      mappings: {
        ...spec.mappings
      },
      ...(spec.title
        ? {
            meta: {
              title: spec.title
            }
          }
        : {})
    };
  }

  private resolveFallbackReason(input: {
    parseResult: ChartBiIntentParseResult;
    validationFailures: string[];
    hasBaseline: boolean;
    rowCount: number;
  }): {
    stage: "parse" | "compile" | "validate";
    reason: string;
  } {
    if (input.validationFailures.length > 0) {
      return {
        stage: "validate",
        reason: `table fallback: ${input.validationFailures.join(" | ")}`
      };
    }

    if (!input.hasBaseline && input.parseResult.status === "failed") {
      return {
        stage: "parse",
        reason: `table fallback: ${input.parseResult.reason}`
      };
    }

    if (input.rowCount === 0) {
      return {
        stage: "compile",
        reason: "table fallback: result set is empty."
      };
    }

    return {
      stage: "compile",
      reason: "table fallback: no canonical chart candidate available."
    };
  }

  private resolveSummaryText(answer: string | undefined, fallback: string): string {
    if (typeof answer === "string" && answer.trim().length > 0) {
      return answer.trim();
    }
    return fallback;
  }

  private toVisualIntentMeta(
    parseResult: ChartBiIntentParseResult
  ): ChartBiArtifactLayer["visualIntent"] {
    if (parseResult.status === "not_provided") {
      return {
        source: "deterministic",
        status: "not_provided"
      };
    }

    if (parseResult.status === "failed") {
      return {
        source: "model",
        status: "failed",
        reason: parseResult.reason,
        rawSyntax: parseResult.raw
      };
    }

    return {
      source: "model",
      status: "parsed",
      ...(parseResult.intent.type
        ? {
            type: parseResult.intent.type
          }
        : {}),
      ...(parseResult.intent.title
        ? {
            title: parseResult.intent.title
          }
        : {}),
      ...(parseResult.intent.insights?.[0]
        ? {
            insight: parseResult.intent.insights[0]
          }
        : {}),
      mappings: {
        ...parseResult.intent.mappings
      },
      rawSyntax: parseResult.normalized,
      normalizedIntent: this.visualIntentToRecord(parseResult.intent)
    };
  }

  private visualIntentToRecord(intent: ChartBiVisualIntent): Record<string, unknown> {
    return {
      ...(intent.type ? { type: intent.type } : {}),
      mappings: {
        ...intent.mappings
      },
      ...(intent.title ? { title: intent.title } : {}),
      ...(intent.insights ? { insights: [...intent.insights] } : {})
    };
  }

  private buildTableBlock(
    profile: ReturnType<ChartBiResultProfiler["profile"]>
  ): ChartBiArtifactLayer["table"] {
    return {
      columns: [...profile.columns],
      rowCount: profile.rowCount,
      rowsPreview: this.cloneRows(profile.previewRows),
      previewRowCount: profile.previewRows.length,
      truncated: profile.rowCount > profile.previewRows.length
    };
  }

  private resolveColumns(
    columns: string[],
    rows: Array<Record<string, unknown>>
  ): string[] {
    const normalized = this.uniqueStrings(columns);
    if (normalized.length > 0) {
      return normalized;
    }
    if (rows.length === 0) {
      return [];
    }
    return this.uniqueStrings(Object.keys(rows[0] ?? {}));
  }

  private uniqueDisplayTypes(values: ChartBiDisplayType[]): ChartBiDisplayType[] {
    const result: ChartBiDisplayType[] = [];
    const seen = new Set<ChartBiDisplayType>();
    for (const value of values) {
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      result.push(value);
    }
    return result;
  }

  private uniqueStrings(values: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      result.push(trimmed);
    }
    return result;
  }

  private stageToReasonCode(stage: "parse" | "compile" | "validate" | "runtime"): string {
    if (stage === "parse") {
      return "chartbi_parse_failed";
    }
    if (stage === "compile") {
      return "chartbi_compile_failed";
    }
    if (stage === "validate") {
      return "chartbi_validation_failed";
    }
    return "chartbi_runtime_failed";
  }

  private cloneRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return rows.map((row) => ({ ...row }));
  }
}
