import { Injectable } from "@nestjs/common";
import type {
  SemanticContextPackV1,
  SemanticPlanLedgerObligationV1,
  SemanticPlanLedgerSummaryV1,
  SemanticPlanCoverageGapV1,
  SemanticPlanV1
} from "@text2sql/shared-types";
import type { SqlSemanticIntent } from "../agent/sql/sql-prompt.builder";
import { SemanticPlanValidator } from "./semantic-plan.validator";

export interface BuildSemanticPlanInput {
  question: string;
  contextPack: SemanticContextPackV1;
  semanticIntent?: SqlSemanticIntent;
  allowedTables?: string[];
}

export type SemanticPlanRouteKind =
  | "text_to_sql"
  | "metadata"
  | "general"
  | "clarify"
  | "fail_closed";

interface ClarificationPolicy {
  round: number;
  maxRounds: number;
}

const METADATA_INTENT_REGEX =
  /(有哪些表|哪些表|schema|表结构|字段|列名|show\s+tables|describe|sqlite_master|sqlite_schema|information_schema|pg_catalog|pragma)/i;
const GENERAL_INTENT_REGEX =
  /^(你好|您好|hi|hello|thanks|谢谢|help|帮助|你是谁|你能做什么)(?:$|\s|[，。,.!?])|(?:什么是|解释|说明).{0,24}(?:口径|定义|含义)|(?:口径|定义|含义)(?:是什么|说明|解释)/i;
const METRIC_KEYWORD_REGEX =
  /(count|sum|avg|average|max|min|总数|数量|金额|平均|均值|占比|转化率|留存|gmv)/gi;
const TIME_GRAIN_DAY_REGEX = /(按天|每天|daily|day\b|date_trunc\(['"]day['"]\))/i;
const TIME_GRAIN_WEEK_REGEX = /(按周|每周|weekly|week\b|date_trunc\(['"]week['"]\))/i;
const TIME_GRAIN_MONTH_REGEX = /(按月|每月|monthly|month\b|date_trunc\(['"]month['"]\))/i;
const FOLLOW_UP_PREFIX_REGEX = /^(那|那么|这个|这些|它们|those|them|that)/i;
const MAX_EVIDENCE_REF_COUNT = 32;
const MAX_METRIC_COUNT = 8;
const MAX_FILTER_COUNT = 12;

@Injectable()
export class SemanticPlanService {
  constructor(private readonly validator: SemanticPlanValidator) {}

  build(input: BuildSemanticPlanInput): {
    plan: SemanticPlanV1;
    validation: ReturnType<SemanticPlanValidator["validate"]>;
  } {
    const selectedTables = this.normalizeList(input.contextPack.selectedTables ?? []);
    const selectedColumns = this.normalizeList(input.contextPack.selectedColumns ?? []);
    const allowedTables = this.normalizeList(input.allowedTables ?? []);
    const evidenceRefs = this.normalizeEvidenceRefs(input.contextPack.selectedEvidenceIds);
    const clarificationPolicy = this.resolveClarificationPolicy(input.contextPack.warnings);
    const routeKind = this.resolveRouteKind({
      question: input.question,
      semanticIntent: input.semanticIntent,
      contextStatus: input.contextPack.status,
      selectedTables,
      selectedColumns,
      evidenceRefs,
      warningCount: input.contextPack.warnings?.length ?? 0,
      clarificationPolicy
    });
    const route = this.toContractRoute(routeKind);
    const confidence = this.resolveConfidence({
      routeKind,
      contextStatus: input.contextPack.status,
      selectedTables,
      selectedColumns,
      evidenceRefs,
      warningCount: input.contextPack.warnings?.length ?? 0
    });
    const standaloneQuestion = this.normalizeStandaloneQuestion({
      question: input.question,
      selectedTables
    });
    const metrics = this.extractMetrics({
      question: standaloneQuestion,
      semanticIntent: input.semanticIntent,
      selectedColumns
    });
    const filters = this.extractFilters({
      question: standaloneQuestion,
      routeKind,
      clarificationPolicy,
      contextWarnings: input.contextPack.warnings
    });
    const joinPath = this.buildJoinPath({
      selectedTables,
      contextPack: input.contextPack
    });
    const forbiddenTables = this.unique([
      ...selectedTables.filter(
        (table) => allowedTables.length > 0 && !allowedTables.includes(table)
      ),
      ...this.readForbiddenTables(input.contextPack.warnings)
    ]);
    const coverageGaps = this.buildCoverageGaps({
      question: standaloneQuestion,
      routeKind,
      selectedTables,
      selectedColumns,
      evidenceRefs,
      clarificationPolicy
    });
    const snapshotId = this.buildSnapshotId({
      routeKind,
      contextStatus: input.contextPack.status,
      selectedTables,
      selectedColumns,
      evidenceRefs,
      coverageGaps
    });

    const planLedger = this.buildPlanLedger({
      selectedTables,
      selectedColumns,
      metrics,
      grain: this.extractGrain(standaloneQuestion),
      filters,
      joinPath,
      forbiddenTables,
      evidenceRefs,
      coverageGaps,
      snapshotId,
      contextPack: input.contextPack
    });

    const plan: SemanticPlanV1 = {
      route,
      standaloneQuestion,
      selectedTables,
      selectedColumns,
      ...(metrics.length > 0 ? { metrics } : {}),
      ...(this.extractGrain(standaloneQuestion)
        ? { grain: this.extractGrain(standaloneQuestion) }
        : {}),
      ...(filters.length > 0 ? { filters } : {}),
      ...(joinPath.length > 0 ? { joinPath } : {}),
      ...(allowedTables.length > 0 ? { allowedTables } : {}),
      ...(forbiddenTables.length > 0 ? { forbiddenTables } : {}),
      confidence,
      evidenceRefs,
      ...(coverageGaps.length > 0 ? { coverageGaps } : {}),
      snapshotId,
      planLedger
    };

    return {
      plan,
      validation: this.validator.validate({
        plan
      })
    };
  }

  private resolveRouteKind(input: {
    question: string;
    semanticIntent?: SqlSemanticIntent;
    contextStatus: SemanticContextPackV1["status"];
    selectedTables: string[];
    selectedColumns: string[];
    evidenceRefs: string[];
    warningCount: number;
    clarificationPolicy: ClarificationPolicy;
  }): SemanticPlanRouteKind {
    const normalizedQuestion = input.question.trim();
    if (input.semanticIntent === "metadata" || METADATA_INTENT_REGEX.test(normalizedQuestion)) {
      return "metadata";
    }
    if (GENERAL_INTENT_REGEX.test(normalizedQuestion)) {
      return "general";
    }

    const hasEvidence = input.evidenceRefs.length > 0;
    const hasGrounding = input.selectedTables.length > 0 || input.selectedColumns.length > 0;
    const evidenceComplete = hasEvidence && hasGrounding;
    const degradedWithoutRagGrounding =
      input.contextStatus === "degraded" && !hasGrounding && !hasEvidence;
    const heavilyDegraded =
      input.contextStatus === "degraded" &&
      input.warningCount >= 2 &&
      !degradedWithoutRagGrounding;

    if (evidenceComplete) {
      return "text_to_sql";
    }
    if (
      heavilyDegraded ||
      input.clarificationPolicy.round >= input.clarificationPolicy.maxRounds
    ) {
      return "fail_closed";
    }
    // Keep answer route for retrieval-unavailable scenarios so downstream SQL path
    // can surface deterministic low-confidence diagnostics instead of clarify loops.
    if (degradedWithoutRagGrounding) {
      return "text_to_sql";
    }
    if (!hasGrounding || !hasEvidence) {
      return "clarify";
    }
    return "text_to_sql";
  }

  private toContractRoute(routeKind: SemanticPlanRouteKind): SemanticPlanV1["route"] {
    if (routeKind === "clarify") {
      return "clarify";
    }
    if (routeKind === "fail_closed") {
      return "reject";
    }
    return "answer";
  }

  private resolveConfidence(input: {
    routeKind: SemanticPlanRouteKind;
    contextStatus: SemanticContextPackV1["status"];
    selectedTables: string[];
    selectedColumns: string[];
    evidenceRefs: string[];
    warningCount: number;
  }): number {
    let base =
      input.routeKind === "metadata"
        ? 0.78
        : input.routeKind === "general"
          ? 0.74
          : input.routeKind === "text_to_sql"
            ? 0.62
            : input.routeKind === "clarify"
              ? 0.34
              : 0.2;
    if (input.selectedTables.length > 0) {
      base += 0.12;
    }
    if (input.selectedColumns.length > 0) {
      base += 0.05;
    }
    if (input.evidenceRefs.length > 0) {
      base += 0.08;
    }
    if (input.contextStatus === "degraded") {
      base -= 0.18;
    }
    base -= Math.min(0.2, input.warningCount * 0.05);
    return Math.max(0, Math.min(1, Number(base.toFixed(4))));
  }

  private normalizeStandaloneQuestion(input: {
    question: string;
    selectedTables: string[];
  }): string {
    const normalized = input.question.trim().replace(/\s+/g, " ");
    if (!FOLLOW_UP_PREFIX_REGEX.test(normalized)) {
      return normalized;
    }
    if (input.selectedTables.length === 0) {
      return normalized;
    }
    return `${normalized} (context: ${input.selectedTables.slice(0, 3).join(", ")})`;
  }

  private normalizeEvidenceRefs(values: string[]): string[] {
    return Array.from(
      new Set(
        values
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .slice(0, MAX_EVIDENCE_REF_COUNT)
      )
    );
  }

  private extractMetrics(input: {
    question: string;
    semanticIntent?: SqlSemanticIntent;
    selectedColumns: string[];
  }): string[] {
    const metrics = new Set<string>();
    if (input.semanticIntent === "count") {
      metrics.add("count");
    }
    const matches = input.question.match(METRIC_KEYWORD_REGEX) ?? [];
    for (const match of matches) {
      metrics.add(match.toLowerCase());
    }
    for (const column of input.selectedColumns) {
      if (/(amount|total|count|rate|ratio|score|gmv|qty|quantity)/i.test(column)) {
        metrics.add(column);
      }
    }
    return Array.from(metrics).slice(0, MAX_METRIC_COUNT);
  }

  private extractGrain(question: string): string | undefined {
    if (TIME_GRAIN_DAY_REGEX.test(question)) {
      return "day";
    }
    if (TIME_GRAIN_WEEK_REGEX.test(question)) {
      return "week";
    }
    if (TIME_GRAIN_MONTH_REGEX.test(question)) {
      return "month";
    }
    return undefined;
  }

  private extractFilters(input: {
    question: string;
    routeKind: SemanticPlanRouteKind;
    clarificationPolicy: ClarificationPolicy;
    contextWarnings?: string[];
  }): string[] {
    const filters: string[] = [`route_kind:${input.routeKind}`];
    if (input.routeKind === "clarify" || input.routeKind === "fail_closed") {
      filters.push(`clarification_round:${input.clarificationPolicy.round}`);
      filters.push(`clarification_max_rounds:${input.clarificationPolicy.maxRounds}`);
    }
    if (/近\d+\s*(天|周|月|年)/i.test(input.question)) {
      filters.push("time_range:relative");
    }
    if (/where|并且|且|过滤|状态|地区|渠道|大于|小于|等于|>=|<=|!=|=/i.test(input.question)) {
      filters.push("filter:present");
    }
    for (const warning of input.contextWarnings ?? []) {
      const normalized = warning.trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      if (
        normalized.includes("dense_unavailable") ||
        normalized.includes("rerank_unavailable")
      ) {
        filters.push(`context_warning:${normalized}`);
      }
    }
    return this.unique(filters).slice(0, MAX_FILTER_COUNT);
  }

  private buildJoinPath(input: {
    selectedTables: string[];
    contextPack: SemanticContextPackV1;
  }): string[] {
    if (input.selectedTables.length < 2) {
      return [];
    }
    const relationshipRefs = input.contextPack.lanes?.relationships?.refs ?? [];
    if (input.contextPack.lanes?.relationships && relationshipRefs.length === 0) {
      return [];
    }
    const joins: string[] = [];
    for (let index = 0; index < input.selectedTables.length - 1; index += 1) {
      const source = input.selectedTables[index];
      const target = input.selectedTables[index + 1];
      if (!source || !target) {
        continue;
      }
      joins.push(`${source}->${target}`);
    }
    return joins;
  }

  private buildPlanLedger(input: {
    selectedTables: string[];
    selectedColumns: string[];
    metrics: string[];
    grain?: string;
    filters: string[];
    joinPath: string[];
    forbiddenTables: string[];
    evidenceRefs: string[];
    coverageGaps: SemanticPlanCoverageGapV1[];
    snapshotId: string;
    contextPack: SemanticContextPackV1;
  }): NonNullable<SemanticPlanV1["planLedger"]> {
    const obligations: SemanticPlanLedgerObligationV1[] = [];
    const hasEvidence = input.evidenceRefs.length > 0;
    const warningOnlyDegraded =
      input.contextPack.status === "degraded" &&
      input.selectedTables.length === 0 &&
      input.selectedColumns.length === 0 &&
      (input.contextPack.warnings ?? []).some((warning) =>
        /rag|dense|rerank|retrieval|unavailable|disabled/i.test(warning)
      );

    for (const table of input.selectedTables) {
      const forbidden = input.forbiddenTables.includes(table);
      obligations.push({
        id: `ledger:table:${table}`,
        kind: forbidden ? "forbidden_table" : "table",
        summary: forbidden
          ? `SQL must not use forbidden table ${table}.`
          : `SQL must use grounded table ${table}.`,
        criticality: "hard_blocker",
        status: forbidden ? "failed" : hasEvidence ? "grounded" : "failed",
        evidenceRefs: input.evidenceRefs,
        reasonCodes: forbidden
          ? ["forbidden_table_selected"]
          : hasEvidence
            ? ["selected_table_grounded"]
            : ["missing_selected_evidence_refs"],
        subject: table
      });
    }

    for (const column of input.selectedColumns) {
      obligations.push({
        id: `ledger:column:${column}`,
        kind: "column",
        summary: `SQL must use grounded column ${column}.`,
        criticality: "hard_blocker",
        status: hasEvidence ? "grounded" : "failed",
        evidenceRefs: input.evidenceRefs,
        reasonCodes: hasEvidence
          ? ["selected_column_grounded"]
          : ["missing_selected_evidence_refs"],
        subject: column
      });
    }

    for (const metric of input.metrics) {
      obligations.push({
        id: `ledger:metric:${this.toLedgerIdToken(metric)}`,
        kind: "metric",
        summary: `SQL must satisfy metric ${metric}.`,
        criticality: warningOnlyDegraded ? "warning" : "hard_blocker",
        status: hasEvidence ? "grounded" : warningOnlyDegraded ? "warning" : "failed",
        evidenceRefs: input.evidenceRefs,
        reasonCodes: hasEvidence ? ["metric_grounded"] : ["metric_grounding_missing"],
        subject: metric
      });
    }

    if (input.grain || input.filters.some((filter) => filter.startsWith("time_range:"))) {
      const subject = input.grain ?? "time_range";
      obligations.push({
        id: `ledger:time-grain:${this.toLedgerIdToken(subject)}`,
        kind: "time_grain",
        summary: `SQL must preserve requested time grain or range: ${subject}.`,
        criticality: warningOnlyDegraded ? "warning" : "hard_blocker",
        status: hasEvidence ? "grounded" : warningOnlyDegraded ? "warning" : "failed",
        evidenceRefs: input.evidenceRefs,
        reasonCodes: hasEvidence ? ["time_grain_grounded"] : ["time_grain_grounding_missing"],
        subject
      });
    }

    for (const filter of input.filters.filter((value) => value.startsWith("filter:"))) {
      obligations.push({
        id: `ledger:filter:${this.toLedgerIdToken(filter)}`,
        kind: "filter",
        summary: `SQL must preserve requested filter signal ${filter}.`,
        criticality: warningOnlyDegraded ? "warning" : "hard_blocker",
        status: hasEvidence ? "grounded" : warningOnlyDegraded ? "warning" : "failed",
        evidenceRefs: input.evidenceRefs,
        reasonCodes: hasEvidence ? ["filter_grounded"] : ["filter_grounding_missing"],
        subject: filter
      });
    }

    if (input.selectedTables.length > 1) {
      const joinPath = input.joinPath.join(" -> ");
      obligations.push({
        id: `ledger:join-path:${input.selectedTables.map((table) => this.toLedgerIdToken(table)).join("-")}`,
        kind: "join_path",
        summary: joinPath
          ? `SQL must preserve join path ${joinPath}.`
          : "SQL generation is blocked until a multi-table join path is grounded.",
        criticality: "hard_blocker",
        status: input.joinPath.length > 0 ? "grounded" : "failed",
        evidenceRefs: input.contextPack.lanes?.relationships?.refs ?? input.evidenceRefs,
        reasonCodes:
          input.joinPath.length > 0
            ? ["join_path_grounded"]
            : ["missing_join_path"],
        subject: joinPath || input.selectedTables.join(",")
      });
    }

    for (const gap of input.coverageGaps) {
      obligations.push({
        id: `ledger:evidence:${gap.subjectKind}:${this.toLedgerIdToken(gap.reasonCode)}`,
        kind: "evidence",
        summary: `Semantic plan has coverage gap ${gap.reasonCode}.`,
        criticality:
          gap.impactScope === "sql_generation" && !warningOnlyDegraded
            ? "hard_blocker"
            : "warning",
        status:
          gap.impactScope === "sql_generation" && !warningOnlyDegraded
            ? "failed"
            : "warning",
        evidenceRefs: gap.evidenceRefs,
        reasonCodes: [gap.reasonCode],
        subject: gap.subjectKind
      });
    }

    for (const warning of input.contextPack.warnings ?? []) {
      const normalized = warning.trim().toLowerCase();
      if (!normalized || normalized.startsWith("clarification_")) {
        continue;
      }
      obligations.push({
        id: `ledger:warning:${this.toLedgerIdToken(normalized)}`,
        kind: "evidence",
        summary: `Context warning: ${normalized}.`,
        criticality: "warning",
        status: "warning",
        evidenceRefs: [],
        reasonCodes: [normalized],
        subject: normalized
      });
    }

    return {
      version: "plan-ledger.v1",
      snapshotId: input.snapshotId,
      obligations,
      summary: this.summarizePlanLedger(input.snapshotId, obligations, input.evidenceRefs)
    };
  }

  private summarizePlanLedger(
    snapshotId: string,
    obligations: SemanticPlanLedgerObligationV1[],
    evidenceRefs: string[]
  ): SemanticPlanLedgerSummaryV1 {
    const failedHardBlockerIds = obligations
      .filter(
        (obligation) =>
          obligation.criticality === "hard_blocker" &&
          (obligation.status === "failed" || obligation.status === "unsupported")
      )
      .map((obligation) => obligation.id);
    const warningIds = obligations
      .filter((obligation) => obligation.criticality === "warning")
      .map((obligation) => obligation.id);
    return {
      snapshotId,
      total: obligations.length,
      hardBlockerCount: obligations.filter(
        (obligation) => obligation.criticality === "hard_blocker"
      ).length,
      warningCount: warningIds.length,
      fulfilledCount: obligations.filter(
        (obligation) =>
          obligation.status === "grounded" ||
          obligation.status === "claimed" ||
          obligation.status === "fulfilled"
      ).length,
      failedCount: obligations.filter(
        (obligation) =>
          obligation.status === "failed" || obligation.status === "unsupported"
      ).length,
      failedHardBlockerIds,
      warningIds,
      reasonCodes: this.unique(obligations.flatMap((obligation) => obligation.reasonCodes)),
      selectedEvidenceRefs: evidenceRefs
    };
  }

  private toLedgerIdToken(value: string): string {
    return (
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/gi, "-")
        .replace(/^-+|-+$/g, "") || "unknown"
    );
  }

  private buildCoverageGaps(input: {
    question: string;
    routeKind: SemanticPlanRouteKind;
    selectedTables: string[];
    selectedColumns: string[];
    evidenceRefs: string[];
    clarificationPolicy: ClarificationPolicy;
  }): SemanticPlanCoverageGapV1[] {
    const gaps: SemanticPlanCoverageGapV1[] = [];
    const hasGrounding =
      input.selectedTables.length > 0 || input.selectedColumns.length > 0;

    if (
      (input.routeKind === "text_to_sql" ||
        input.routeKind === "clarify" ||
        input.routeKind === "fail_closed") &&
      (input.evidenceRefs.length === 0 || !hasGrounding)
    ) {
      gaps.push({
        gapType: "evidence_gap",
        subjectKind: this.resolveEvidenceGapSubjectKind(input),
        reasonCode:
          input.evidenceRefs.length === 0
            ? "missing_selected_evidence_refs"
            : "missing_structured_grounding",
        evidenceRefs: input.evidenceRefs,
        impactScope: "sql_generation"
      });
    }

    if (input.routeKind === "clarify" || input.routeKind === "fail_closed") {
      gaps.push({
        gapType: "user_decision_gap",
        subjectKind: this.resolveDecisionGapSubjectKind(input.question),
        reasonCode:
          input.routeKind === "fail_closed"
            ? input.clarificationPolicy.round >= input.clarificationPolicy.maxRounds
              ? "clarification_budget_exhausted"
              : "semantic_plan_fail_closed"
            : "semantic_plan_requires_clarification",
        evidenceRefs: input.evidenceRefs,
        impactScope:
          input.routeKind === "fail_closed" ? "execution" : "clarification"
      });
    }

    return gaps;
  }

  private resolveEvidenceGapSubjectKind(input: {
    question: string;
    selectedTables: string[];
    selectedColumns: string[];
    evidenceRefs: string[];
  }): SemanticPlanCoverageGapV1["subjectKind"] {
    if (input.selectedTables.length === 0 && input.selectedColumns.length === 0) {
      if (this.resolveDecisionGapSubjectKind(input.question) === "time") {
        return "time";
      }
      if (this.resolveDecisionGapSubjectKind(input.question) === "metric") {
        return "metric";
      }
      return "table";
    }
    if (input.evidenceRefs.length === 0) {
      return input.selectedColumns.length > 0 ? "column" : "table";
    }
    return "general";
  }

  private resolveDecisionGapSubjectKind(
    question: string
  ): SemanticPlanCoverageGapV1["subjectKind"] {
    if (!question.trim()) {
      return "general";
    }
    if (!question.match(METRIC_KEYWORD_REGEX)) {
      return "metric";
    }
    if (!this.extractGrain(question) && !/近\d+\s*(天|周|月|年)|昨天|今天|本周|本月|本季度|本年/i.test(question)) {
      return "time";
    }
    return "general";
  }

  private buildSnapshotId(input: {
    routeKind: SemanticPlanRouteKind;
    contextStatus: SemanticContextPackV1["status"];
    selectedTables: string[];
    selectedColumns: string[];
    evidenceRefs: string[];
    coverageGaps: SemanticPlanCoverageGapV1[];
  }): string {
    const routeToken = input.routeKind.replace(/[^a-z0-9]+/gi, "-");
    const contextToken = input.contextStatus === "degraded" ? "degraded" : "ready";
    const tableToken =
      input.selectedTables.slice(0, 2).join("+").replace(/[^a-z0-9+_.-]+/gi, "-") ||
      "none";
    return [
      "semantic-plan",
      routeToken,
      contextToken,
      `t${input.selectedTables.length}`,
      `c${input.selectedColumns.length}`,
      `e${input.evidenceRefs.length}`,
      `g${input.coverageGaps.length}`,
      tableToken
    ].join(":");
  }

  private readForbiddenTables(warnings?: string[]): string[] {
    if (!warnings) {
      return [];
    }
    const forbidden: string[] = [];
    for (const warning of warnings) {
      const normalized = warning.trim();
      if (!normalized) {
        continue;
      }
      const match = /forbidden_table:([a-zA-Z_][\w$]*)/i.exec(normalized);
      if (!match?.[1]) {
        continue;
      }
      const token = this.normalizeIdentifier(match[1]);
      if (token) {
        forbidden.push(token);
      }
    }
    return this.unique(forbidden);
  }

  private resolveClarificationPolicy(warnings?: string[]): ClarificationPolicy {
    const policy: ClarificationPolicy = {
      round: 0,
      maxRounds: 2
    };
    for (const warning of warnings ?? []) {
      const normalized = warning.trim();
      if (!normalized) {
        continue;
      }
      const roundMatch = /clarification_round:(\d+)/i.exec(normalized);
      if (roundMatch?.[1]) {
        policy.round = Math.max(policy.round, Number(roundMatch[1]));
      }
      const maxMatch = /clarification_max_rounds:(\d+)/i.exec(normalized);
      if (maxMatch?.[1]) {
        policy.maxRounds = Math.max(1, Number(maxMatch[1]));
      }
    }
    return policy;
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
  }

  private normalizeList(values: string[]): string[] {
    return Array.from(
      new Set(
        values
          .map((value) => this.normalizeIdentifier(value))
          .filter((value): value is string => Boolean(value))
      )
    );
  }

  private normalizeIdentifier(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value
      .trim()
      .replace(/^[`"'\[\]]+|[`"'\[\]]+$/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    return normalized.length > 0 ? normalized : undefined;
  }
}
