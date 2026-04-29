import { Injectable } from "@nestjs/common";
import type {
  SqlCorrectionGroundingV1,
  DatasourceType,
  PromptTemplateTraceEvidence,
  SemanticPlanLedgerObligationV1,
  SemanticPlanV1,
  SqlGenerationArtifactV1,
  Text2SqlV2SmartDefaultsEvidenceV1,
  Text2SqlV2ProviderMetadata
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import type {
  LlmGatewayPrompt,
  LlmGatewayStreamEvent,
  LlmGatewayToolDefinition
} from "../../../llm/llm-gateway.interface";
import type { LlmDraft } from "../../../llm/provider-router.service";
import { ProviderRouterService } from "../../../llm/provider-router.service";
import { SqlOutputExtractor } from "./sql-output-extractor";
import {
  SqlPromptBuilder,
  type SqlSemanticIntent
} from "./sql-prompt.builder";
import { PromptTemplateService } from "../../../governance/settings/prompt-template.service";
import { Text2SqlSmartDefaultsService } from "../../runtime/smart-defaults/text2sql-smart-defaults.service";
import type { RetrievedKnowledge } from "../nodes/retrieve-knowledge.node";
import type { RagContextPack } from "../../../rag/retrieval/rag-retrieval.types";

type RagRetrievalChunkPayload = NonNullable<
  NonNullable<RetrievedKnowledge["retrievalBundle"]>["selected_context"]
>[number];

interface SqlGenerationSelection {
  datasourceId?: string;
  workspaceId?: string;
  datasourceType?: DatasourceType;
  modelCatalogId?: string;
  selectedContext?: RagRetrievalChunkPayload[];
  selected_context?: RagRetrievalChunkPayload[];
  semanticContextPack?: RagContextPack;
  semanticIntent?: SqlSemanticIntent;
  explicitPinning?: SqlGenerationExplicitPinningEvidence;
  semanticPlan?: SemanticPlanV1;
  correctionGrounding?: SqlCorrectionGroundingV1;
}

export interface SqlGenerationExplicitPinningEvidence {
  source?: string;
  tables?: string[];
  columns?: string[];
}

export type SqlGenerationCause =
  | "initial"
  | "saved-prior"
  | "shortcut-fallback"
  | "correction";

export interface StructuredSqlGenerationArtifact extends SqlGenerationArtifactV1 {
  cause: SqlGenerationCause;
  dialect: DatasourceType;
  provider?: Text2SqlV2ProviderMetadata;
  promptTemplate?: PromptTemplateTraceEvidence;
  smartDefaults?: Text2SqlV2SmartDefaultsEvidenceV1;
  retryReason?: string;
  coverage?: SqlEvidenceCoverage;
}

const MAX_SEMANTIC_REPAIR_RETRY = 1;
const COUNT_INTENT_REGEX =
  /(多少|几条|几笔|总数|数量|计数|count|人数|单量|订单量|客户数|用户数)/i;
const GROUPED_COUNT_INTENT_REGEX =
  /(比例|占比|分布|各|每|多少种|几种|方式|类型|类别|渠道|状态)/i;
const AMOUNT_METRIC_INTENT_REGEX =
  /(销售额|净销售额|成交额|交易额|营收|收入|金额|gmv|sales|revenue|amount)/i;
const COMPLEX_AMOUNT_METRIC_INTENT_REGEX =
  /(平均|均值|最大|最高|最小|最低|按|每|各|分组|分布|趋势|同比|环比|排名|月份|月|周|日|年|地区|渠道|类别|类型|状态|avg|average|max|min|top)/i;
const RECENT_TIME_INTENT_REGEX =
  /(最近|近期|近\s*\d*|latest|recent|last\s+\d*)/i;
const AMOUNT_COLUMN_REGEX =
  /(^|_)(total_amount|net_sales|sales_amount|gmv|revenue|amount|subtotal_amount|price_total|order_total)$/i;
const LOW_PRIORITY_AMOUNT_COLUMN_REGEX =
  /(^|_)(discount_amount|shipping_amount|tax_amount|refund_amount)$/i;
const METADATA_INTENT_REGEX =
  /(有哪些表|哪些表|多少张表|多少个表|表结构|schema|字段|列名|describe|desc\s+\w+|show\s+tables|sqlite_master|sqlite_schema|information_schema|pg_catalog|pragma|元数据|数据库结构)/i;
const COUNT_SQL_REGEX = /\bcount\s*\(/i;
const METADATA_SQL_REGEX =
  /\bsqlite_master\b|\bsqlite_schema\b|\binformation_schema\b|\bpg_catalog\b|\bshow\s+tables\b|\bdescribe\b|\bpragma\b/i;
const SQL_TABLE_REF_REGEX = /\b(?:from|join)\s+([`"'[\]]?[a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?[`"'[\]]?)/gi;
const SQL_QUALIFIED_COLUMN_REGEX = /\b([a-zA-Z_][\w$]*)\.([a-zA-Z_][\w$]*)\b/g;
const SQL_CTE_REGEX = /(?:\bwith\b|,)\s*([a-zA-Z_][\w$]*)\s+as\s*\(/gi;

export type SqlCoverageTriggerSource =
  | "selected_context"
  | "semantic_context"
  | "explicit_pinning"
  | "none";

export interface SqlEvidenceCoverage {
  gateStatus:
    | "passed"
    | "failed"
    | "skipped_no_evidence"
    | "skipped_metadata_intent"
    | "skipped_no_sql_objects";
  missingObjects: string[];
  triggerSource: SqlCoverageTriggerSource;
  usedObjects: string[];
}

export interface SqlDraft {
  provider: string;
  model: string;
  modelCatalogId?: string;
  sql: string;
  explanation: string;
  rawText: string;
  prompt: LlmGatewayPrompt;
  promptTemplate?: PromptTemplateTraceEvidence;
  smartDefaults?: Text2SqlV2SmartDefaultsEvidenceV1;
  retryCount?: number;
  semanticIntent?: SqlSemanticIntent;
  coverage?: SqlEvidenceCoverage;
  semanticPlan?: SemanticPlanV1;
}

@Injectable()
export class SqlGenerationService {
  constructor(
    private readonly promptBuilder: SqlPromptBuilder,
    private readonly extractor: SqlOutputExtractor,
    private readonly providerRouter: ProviderRouterService,
    private readonly promptTemplateService: PromptTemplateService,
    private readonly smartDefaultsService: Text2SqlSmartDefaultsService
  ) {}

  async generate(
    question: string,
    selection?: SqlGenerationSelection
  ): Promise<SqlDraft> {
    const templateResolution = await this.resolvePromptTemplate(selection);
    const semanticIntent = this.resolveSemanticIntent(
      question,
      selection?.semanticIntent,
      selection?.semanticPlan
    );
    const smartDefaults = this.smartDefaultsService.resolve({
      promptTemplate: templateResolution.evidence,
      fallbackReason: templateResolution.evidence.fallbackReason
    });
    const prompt = this.buildPrompt(
      question,
      selection,
      templateResolution.templateOverlay,
      semanticIntent,
      smartDefaults.promptBlock
    );
    const completion = await this.providerRouter.generate(prompt, selection);
    return this.finalizeWithSemanticGuardrails({
      question,
      selection,
      semanticIntent,
      prompt,
      completion,
      templateOverlay: templateResolution.templateOverlay,
      promptTemplate: templateResolution.evidence,
      smartDefaults: smartDefaults.evidence
    });
  }

  async stream(
    question: string,
    selection?: SqlGenerationSelection,
    options?: {
      tools?: Record<string, LlmGatewayToolDefinition>;
      onEvent?: (event: LlmGatewayStreamEvent) => Promise<void> | void;
    }
  ): Promise<SqlDraft> {
    const templateResolution = await this.resolvePromptTemplate(selection);
    const semanticIntent = this.resolveSemanticIntent(
      question,
      selection?.semanticIntent,
      selection?.semanticPlan
    );
    const smartDefaults = this.smartDefaultsService.resolve({
      promptTemplate: templateResolution.evidence,
      fallbackReason: templateResolution.evidence.fallbackReason
    });
    const prompt = this.buildPrompt(
      question,
      selection,
      templateResolution.templateOverlay,
      semanticIntent,
      smartDefaults.promptBlock
    );
    const immediateShortcut =
      this.buildGroupedCountProportionShortcut(question, selection) ??
      this.buildAmountMetricShortcut(question, selection) ??
      this.buildSimpleCountShortcut(question, selection);
    let completion: LlmDraft;
    if (immediateShortcut) {
      completion = this.buildSemanticShortcutCompletion({
        prompt,
        shortcut: immediateShortcut,
        summary: "已根据语义计划与已选证据生成保守只读 SQL。"
      });
    } else {
      try {
        completion = await this.providerRouter.stream(prompt, selection, options);
      } catch (error) {
        if (!this.shouldRetryAsNonStream(error)) {
          const shortcutCompletion = this.buildRecoverableStreamFailureShortcut({
            question,
            selection,
            semanticIntent,
            prompt,
            error
          });
          if (!shortcutCompletion) {
            throw error;
          }
          completion = shortcutCompletion;
        } else {
          completion = await this.providerRouter.generate(prompt, selection);
        }
      }
    }
    return this.finalizeWithSemanticGuardrails({
      question,
      selection,
      semanticIntent,
      prompt,
      completion,
      templateOverlay: templateResolution.templateOverlay,
      promptTemplate: templateResolution.evidence,
      smartDefaults: smartDefaults.evidence
    });
  }

  buildStructuredArtifact(input: {
    draft: SqlDraft;
    datasourceType?: DatasourceType;
    cause: SqlGenerationCause;
    retryReason?: string;
    correctionGrounding?: SqlCorrectionGroundingV1;
  }): StructuredSqlGenerationArtifact {
    const references = this.extractSqlReferences(input.draft.sql);
    const evidenceRefs = this.unique(input.draft.semanticPlan?.evidenceRefs ?? []);
    const obligationClaims = this.buildObligationClaims({
      sql: input.draft.sql,
      references,
      semanticPlan: input.draft.semanticPlan
    });
    const provider =
      input.draft.provider || input.draft.model || input.draft.modelCatalogId
        ? {
            provider: input.draft.provider,
            model: input.draft.model
          }
        : undefined;

    return {
      sql: input.draft.sql,
      assumptions: input.draft.explanation
        ? [input.draft.explanation]
        : undefined,
      usedTables: Array.from(references.tables),
      usedColumns: this.unique([
        ...Array.from(references.tableColumns),
        ...Array.from(references.columns)
      ]),
      evidenceRefs,
      cause: input.cause,
      dialect: input.datasourceType ?? "sqlite",
      provider,
      promptTemplate: input.draft.promptTemplate,
      smartDefaults: input.draft.smartDefaults,
      retryReason: input.retryReason?.trim() || undefined,
      coverage: input.draft.coverage,
      correctionGrounding: input.correctionGrounding,
      claimedObligationIds: obligationClaims.claimedObligationIds,
      unsupportedClaims: obligationClaims.unsupportedClaims,
      ledgerSnapshotId: input.draft.semanticPlan?.planLedger?.snapshotId ?? input.draft.semanticPlan?.snapshotId
    };
  }

  private buildObligationClaims(input: {
    sql: string;
    references: {
      tables: Set<string>;
      columns: Set<string>;
      tableColumns: Set<string>;
    };
    semanticPlan?: SemanticPlanV1;
  }): {
    claimedObligationIds?: string[];
    unsupportedClaims?: SqlGenerationArtifactV1["unsupportedClaims"];
  } {
    const obligations = input.semanticPlan?.planLedger?.obligations ?? [];
    const claimedObligationIds = obligations
      .filter((obligation) => this.isObligationClaimed(obligation, input))
      .map((obligation) => obligation.id);
    const unsupportedClaims = this.findUnsupportedClaims({
      references: input.references,
      semanticPlan: input.semanticPlan,
      obligations
    });
    return {
      claimedObligationIds:
        claimedObligationIds.length > 0 ? this.unique(claimedObligationIds) : undefined,
      unsupportedClaims: unsupportedClaims.length > 0 ? unsupportedClaims : undefined
    };
  }

  private isObligationClaimed(
    obligation: SemanticPlanLedgerObligationV1,
    input: {
      sql: string;
      references: {
        tables: Set<string>;
        columns: Set<string>;
        tableColumns: Set<string>;
      };
    }
  ): boolean {
    const subject = obligation.subject ? this.normalizeQualifiedIdentifier(obligation.subject) : undefined;
    const unqualifiedSubject = obligation.subject ? this.normalizeIdentifier(obligation.subject) : undefined;
    if (!subject && !unqualifiedSubject) {
      return false;
    }
    if (obligation.kind === "table" || obligation.kind === "forbidden_table") {
      return Boolean(unqualifiedSubject && input.references.tables.has(unqualifiedSubject));
    }
    if (obligation.kind === "column") {
      return Boolean(
        (subject && input.references.tableColumns.has(subject)) ||
          (unqualifiedSubject && input.references.columns.has(unqualifiedSubject))
      );
    }
    if (obligation.kind === "metric") {
      return Boolean(
        unqualifiedSubject &&
          (new RegExp(`\\b${this.escapeRegex(unqualifiedSubject)}\\b`, "i").test(input.sql) ||
            /\b(count|sum|avg|min|max)\s*\(/i.test(input.sql))
      );
    }
    if (obligation.kind === "time_grain") {
      return /\b(date_trunc|strftime|extract|group\s+by|where)\b/i.test(input.sql);
    }
    if (obligation.kind === "filter") {
      return /\bwhere\b/i.test(input.sql);
    }
    if (obligation.kind === "join_path") {
      return /\bjoin\b/i.test(input.sql);
    }
    return false;
  }

  private findUnsupportedClaims(input: {
    references: {
      tables: Set<string>;
      columns: Set<string>;
      tableColumns: Set<string>;
    };
    semanticPlan?: SemanticPlanV1;
    obligations: SemanticPlanLedgerObligationV1[];
  }): NonNullable<SqlGenerationArtifactV1["unsupportedClaims"]> {
    const supportedTables = new Set([
      ...this.normalizeList(input.semanticPlan?.selectedTables ?? []),
      ...input.obligations
        .filter((obligation) => obligation.kind === "table")
        .map((obligation) => this.normalizeIdentifier(obligation.subject))
        .filter((value): value is string => Boolean(value))
    ]);
    const supportedColumns = new Set([
      ...this.normalizeList(input.semanticPlan?.selectedColumns ?? []),
      ...input.obligations
        .filter((obligation) => obligation.kind === "column")
        .map((obligation) => this.normalizeQualifiedIdentifier(obligation.subject))
        .filter((value): value is string => Boolean(value))
    ]);
    const unsupported: NonNullable<SqlGenerationArtifactV1["unsupportedClaims"]> = [];
    for (const table of input.references.tables) {
      if (supportedTables.size > 0 && !supportedTables.has(table)) {
        unsupported.push({
          kind: "table",
          value: table,
          reasonCode: "table_not_in_ledger"
        });
      }
    }
    for (const column of input.references.tableColumns) {
      if (supportedColumns.size > 0 && !supportedColumns.has(column)) {
        unsupported.push({
          kind: "column",
          value: column,
          reasonCode: "column_not_in_ledger"
        });
      }
    }
    return unsupported;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private shouldRetryAsNonStream(error: unknown): boolean {
    if (!(error instanceof DomainError)) {
      return false;
    }
    return (
      error.code === "LLM_TOOL_CALL_ONLY_RESPONSE" ||
      error.code === "LLM_SQL_EXTRACT_FAILED" ||
      error.code === "LLM_TOOL_CALL_EXECUTION_FAILED"
    );
  }

  private buildRecoverableStreamFailureShortcut(input: {
    question: string;
    selection: SqlGenerationSelection | undefined;
    semanticIntent: SqlSemanticIntent;
    prompt: LlmGatewayPrompt;
    error: unknown;
  }): LlmDraft | undefined {
    if (
      input.semanticIntent !== "count" ||
      !this.isRecoverableProviderStreamFailure(input.error)
    ) {
      return undefined;
    }

    const shortcut = this.buildGroupedCountProportionShortcut(
      input.question,
      input.selection
    ) ?? this.buildAmountMetricShortcut(input.question, input.selection) ??
      this.buildSimpleCountShortcut(input.question, input.selection);
    if (!shortcut) {
      return undefined;
    }

    return this.buildSemanticShortcutCompletion({
      prompt: input.prompt,
      shortcut,
      summary:
        "上游模型流式响应不可用，已根据语义计划与已选证据生成保守只读 SQL。"
    });
  }

  private buildSemanticShortcutCompletion(input: {
    prompt: LlmGatewayPrompt;
    shortcut: { sql: string; model: string };
    summary: string;
  }): LlmDraft {
    return {
      provider: "semantic-shortcut",
      model: input.shortcut.model,
      rawText: [
        input.summary,
        "```sql",
        input.shortcut.sql.replace(/;+\s*$/, ""),
        "```"
      ].join("\n"),
      prompt: input.prompt
    };
  }

  private isRecoverableProviderStreamFailure(error: unknown): boolean {
    if (!(error instanceof DomainError) || error.code !== "LLM_REQUEST_FAILED") {
      return false;
    }
    return /(流式请求失败|invalid json response|aborted due to timeout|timeout)/i.test(
      error.message
    );
  }

  private buildGroupedCountProportionShortcut(
    question: string,
    selection: SqlGenerationSelection | undefined
  ): { sql: string; model: string } | undefined {
    const selectedTables = this.resolveShortcutSelectedTables(selection?.semanticPlan);
    if (!selectedTables || selectedTables.length !== 1) {
      return undefined;
    }
    if (!GROUPED_COUNT_INTENT_REGEX.test(question)) {
      return undefined;
    }

    const table = selectedTables[0];
    const groupColumn = this.resolveGroupedCountColumn({
      question,
      table,
      columns: selection?.semanticPlan?.selectedColumns ?? []
    });
    if (!groupColumn) {
      return undefined;
    }

    return {
      model: "grouped-count-proportion-v1",
      sql: [
        `SELECT ${groupColumn} AS group_value,`,
        "  COUNT(*) AS item_count,",
        "  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS item_percentage",
        `FROM ${table}`,
        `GROUP BY ${groupColumn}`,
        "ORDER BY item_count DESC;"
      ].join("\n")
    };
  }

  private buildSimpleCountShortcut(
    question: string,
    selection: SqlGenerationSelection | undefined
  ): { sql: string; model: string } | undefined {
    const selectedTables = this.resolveShortcutSelectedTables(selection?.semanticPlan);
    if (!selectedTables || selectedTables.length !== 1) {
      return undefined;
    }
    if (GROUPED_COUNT_INTENT_REGEX.test(question)) {
      return undefined;
    }
    if (
      !this.hasExplicitCountShortcutIntent(question, selection?.semanticPlan) ||
      this.hasAmountMetricIntent(question, selection?.semanticPlan)
    ) {
      return undefined;
    }

    return {
      model: "simple-count-v1",
      sql: `SELECT COUNT(*) AS total_count FROM ${selectedTables[0]};`
    };
  }

  private buildAmountMetricShortcut(
    question: string,
    selection: SqlGenerationSelection | undefined
  ): { sql: string; model: string } | undefined {
    const semanticPlan = selection?.semanticPlan;
    const selectedTables = this.resolveShortcutSelectedTables(semanticPlan);
    if (
      !selectedTables ||
      selectedTables.length !== 1 ||
      !this.hasAmountMetricIntent(question, semanticPlan) ||
      COMPLEX_AMOUNT_METRIC_INTENT_REGEX.test(question)
    ) {
      return undefined;
    }

    const table = selectedTables[0];
    const amountColumn = this.resolveAmountMetricColumn({
      table,
      columns: semanticPlan?.selectedColumns ?? []
    });
    if (!amountColumn) {
      return undefined;
    }
    const amountExpression = `${table}.${amountColumn}`;

    const timeColumns = this.resolveRecentTimeColumns({
      table,
      columns: semanticPlan?.selectedColumns ?? []
    });
    if (RECENT_TIME_INTENT_REGEX.test(question) && timeColumns.length > 0) {
      const qualifiedTimeColumns = timeColumns.map((column) => `${table}.${column}`);
      const timeExpression =
        qualifiedTimeColumns.length === 1
          ? qualifiedTimeColumns[0]
          : `COALESCE(${qualifiedTimeColumns.join(", ")})`;
      return {
        model: "amount-metric-sum-v1",
        sql: [
          `SELECT ROUND(SUM(${amountExpression}), 2) AS recent_sales`,
          `FROM ${table}`,
          `WHERE date(${timeExpression}) >= (`,
          `  SELECT date(MAX(${timeExpression}), '-30 days') FROM ${table}`,
          ");"
        ].join("\n")
      };
    }

    return {
      model: "amount-metric-sum-v1",
      sql: [
        `SELECT ROUND(SUM(${amountExpression}), 2) AS total_sales`,
        `FROM ${table};`
      ].join("\n")
    };
  }

  private hasExplicitCountShortcutIntent(
    question: string,
    semanticPlan: SemanticPlanV1 | undefined
  ): boolean {
    return (
      COUNT_INTENT_REGEX.test(question) ||
      (semanticPlan?.metrics ?? []).some((metric) =>
        /(^|[._:-])count($|[._:-])|^count$/i.test(metric)
      )
    );
  }

  private hasAmountMetricIntent(
    question: string,
    semanticPlan: SemanticPlanV1 | undefined
  ): boolean {
    return (
      AMOUNT_METRIC_INTENT_REGEX.test(question) ||
      (semanticPlan?.metrics ?? []).some((metric) =>
        AMOUNT_METRIC_INTENT_REGEX.test(metric)
      )
    );
  }

  private resolveAmountMetricColumn(input: {
    table: string;
    columns: string[];
  }): string | undefined {
    const candidates = this.resolveShortcutColumnsForTable(input);
    const scored = candidates
      .map((column, index) => ({
        column,
        index,
        score: this.scoreAmountMetricColumn(column)
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    return scored[0]?.column;
  }

  private scoreAmountMetricColumn(column: string): number {
    const normalizedColumn = column.toLowerCase();
    const exactScores: Record<string, number> = {
      total_amount: 20,
      net_sales: 18,
      sales_amount: 17,
      gmv: 16,
      revenue: 15,
      amount: 14,
      subtotal_amount: 12,
      price_total: 10,
      order_total: 10
    };
    if (exactScores[normalizedColumn] !== undefined) {
      return exactScores[normalizedColumn];
    }
    if (LOW_PRIORITY_AMOUNT_COLUMN_REGEX.test(normalizedColumn)) {
      return 1;
    }
    return AMOUNT_COLUMN_REGEX.test(normalizedColumn) ? 8 : 0;
  }

  private resolveRecentTimeColumns(input: {
    table: string;
    columns: string[];
  }): string[] {
    const candidates = this.resolveShortcutColumnsForTable(input);
    const preferredColumns = ["paid_at", "created_at", "order_date", "date"];
    return preferredColumns.filter((column) => candidates.includes(column));
  }

  private resolveShortcutColumnsForTable(input: {
    table: string;
    columns: string[];
  }): string[] {
    return this.unique(
      input.columns
        .map((column) => this.normalizeQualifiedIdentifier(column))
        .filter((column): column is string => Boolean(column))
        .map((column) => {
          const [tableName, columnName] = column.includes(".")
            ? column.split(".")
            : [input.table, column];
          if (tableName !== input.table || !columnName) {
            return undefined;
          }
          return columnName;
        })
        .filter((column): column is string => Boolean(column))
        .filter((column) => this.isSafeSqlIdentifier(column))
    );
  }

  private resolveShortcutSelectedTables(
    semanticPlan: SemanticPlanV1 | undefined
  ): string[] | undefined {
    if (!semanticPlan || this.resolveSemanticPlanRouteKind(semanticPlan) !== "text_to_sql") {
      return undefined;
    }
    const selectedTables = this.unique(
      semanticPlan.selectedTables
        .map((item) => this.normalizeIdentifier(item))
        .filter((item): item is string => Boolean(item))
    );
    if (selectedTables.some((table) => !this.isSafeSqlIdentifier(table))) {
      return undefined;
    }
    return selectedTables;
  }

  private resolveGroupedCountColumn(input: {
    question: string;
    table: string;
    columns: string[];
  }): string | undefined {
    const normalizedQuestion = input.question.toLowerCase();
    const candidates = this.unique(
      input.columns
        .map((column) => this.normalizeQualifiedIdentifier(column))
        .filter((column): column is string => Boolean(column))
        .map((column) => {
          const [tableName, columnName] = column.includes(".")
            ? column.split(".")
            : [input.table, column];
          if (tableName !== input.table || !columnName) {
            return undefined;
          }
          return columnName;
        })
        .filter((column): column is string => Boolean(column))
        .filter((column) => this.isSafeSqlIdentifier(column))
    );

    const scored = candidates
      .map((column, index) => ({
        column,
        index,
        score: this.scoreGroupedCountColumn(normalizedQuestion, column)
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    return scored[0]?.column;
  }

  private scoreGroupedCountColumn(question: string, column: string): number {
    const normalizedColumn = column.toLowerCase();
    let score = 0;
    const hints: Array<{ pattern: RegExp; columns: string[]; weight: number }> = [
      {
        pattern: /(支付方式|支付渠道|付款方式|方式|渠道|payment|method)/i,
        columns: ["method"],
        weight: 8
      },
      { pattern: /(状态|status)/i, columns: ["status"], weight: 8 },
      { pattern: /(类型|type)/i, columns: ["type"], weight: 8 },
      {
        pattern: /(分类|类目|类别|category)/i,
        columns: ["category", "category_id"],
        weight: 8
      }
    ];

    for (const hint of hints) {
      if (hint.pattern.test(question) && hint.columns.includes(normalizedColumn)) {
        score += hint.weight;
      }
    }

    if (/^(method|status|type|category)$/.test(normalizedColumn)) {
      score += 3;
    }
    if (/(多少种|几种|分布|比例|占比)/i.test(question)) {
      score += /(_id|id|amount|price|total|count|created_at|updated_at|paid_at)$/i.test(
        normalizedColumn
      )
        ? -4
        : 1;
    }
    return score;
  }

  private isSafeSqlIdentifier(value: string): boolean {
    return /^[a-zA-Z_][\w$]*$/.test(value);
  }

  private buildPrompt(
    question: string,
    selection: SqlGenerationSelection | undefined,
    templateOverlay: string | undefined,
    semanticIntent: SqlSemanticIntent,
    smartDefaults:
      | { evidence: Text2SqlV2SmartDefaultsEvidenceV1; promptBlock: string }
      | Text2SqlV2SmartDefaultsEvidenceV1
      | string,
    retryReason?: string
  ): LlmGatewayPrompt {
    const smartDefaultsBlock =
      typeof smartDefaults === "string"
        ? smartDefaults
        : "promptBlock" in smartDefaults
          ? smartDefaults.promptBlock
          : this.smartDefaultsService.resolve().promptBlock;
    return this.promptBuilder.build(
      question,
      selection?.datasourceType,
      this.resolveSelectedContext(selection),
      {
        templateOverlay,
        semanticGuardrail: {
          intent: semanticIntent,
          retryReason
        },
        semanticContextPack: selection?.semanticContextPack,
        semanticPlan: selection?.semanticPlan,
        correctionGrounding: selection?.correctionGrounding,
        smartDefaultsBlock
      }
    );
  }

  private resolveSelectedContext(
    selection?: SqlGenerationSelection
  ): RagRetrievalChunkPayload[] | undefined {
    return selection?.selectedContext ?? selection?.selected_context;
  }

  private async finalizeWithSemanticGuardrails(input: {
    question: string;
    selection: SqlGenerationSelection | undefined;
    semanticIntent: SqlSemanticIntent;
    prompt: LlmGatewayPrompt;
    completion: LlmDraft;
    templateOverlay?: string;
    promptTemplate: PromptTemplateTraceEvidence;
    smartDefaults: Text2SqlV2SmartDefaultsEvidenceV1;
  }): Promise<SqlDraft> {
    this.assertSemanticPlan(input.selection?.semanticPlan);
    let retryCount = 0;
    let prompt = input.prompt;
    let completion = input.completion;

    while (true) {
      try {
        const extracted = this.extractor.extract(completion.rawText);
        const validation = this.validateSemanticIntent(
          input.semanticIntent,
          extracted.sql
        );
        if (validation.valid) {
          const coverage = this.validateEvidenceCoverage({
            sql: extracted.sql,
            semanticIntent: input.semanticIntent,
            selection: input.selection
          });
          if (!coverage.valid) {
            throw new DomainError(
              "LLM_SQL_EVIDENCE_COVERAGE_FAILED",
              "SQL 证据覆盖校验失败，已阻止不具备证据覆盖的 SQL 输出。",
              422,
              {
                reason: coverage.reason,
                coverage: coverage.evidence
              }
            );
          }
          const semanticPlanCoverage = this.validateSemanticPlanCoverage({
            sql: extracted.sql,
            semanticPlan: input.selection?.semanticPlan
          });
          if (!semanticPlanCoverage.valid) {
            throw new DomainError(
              "LLM_SQL_PLAN_COVERAGE_FAILED",
              "SQL 超出了语义计划允许范围，已阻止该输出。",
              422,
              {
                reason: semanticPlanCoverage.reason,
                missingObjects: semanticPlanCoverage.missingObjects
              }
            );
          }
          return {
            provider: completion.provider,
            model: completion.model,
            modelCatalogId: completion.modelCatalogId,
            sql: extracted.sql,
            explanation: extracted.explanation || completion.rawText,
            rawText: completion.rawText,
            prompt,
            promptTemplate: input.promptTemplate,
            smartDefaults: input.smartDefaults,
            retryCount,
            semanticIntent: input.semanticIntent,
            coverage: coverage.evidence,
            semanticPlan: input.selection?.semanticPlan
          };
        }

        if (retryCount >= MAX_SEMANTIC_REPAIR_RETRY) {
          throw new DomainError(
            "LLM_SQL_SEMANTIC_GUARDRAIL_FAILED",
            "SQL 语义护栏校验失败，且一次修复重试后仍未通过。",
            502,
            {
              semanticIntent: input.semanticIntent,
              reason: validation.reason,
              sql: extracted.sql.slice(0, 400)
            }
          );
        }

        retryCount += 1;
        prompt = this.buildPrompt(
          input.question,
          input.selection,
          input.templateOverlay,
          input.semanticIntent,
          input.smartDefaults,
          validation.reason
        );
        completion = await this.providerRouter.generate(prompt, input.selection);
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "LLM_SQL_EXTRACT_FAILED") {
          throw error;
        }
        if (retryCount >= MAX_SEMANTIC_REPAIR_RETRY) {
          throw error;
        }
        retryCount += 1;
        prompt = this.buildPrompt(
          input.question,
          input.selection,
          input.templateOverlay,
          input.semanticIntent,
          input.smartDefaults,
          "no executable SQL was extracted from the previous output"
        );
        completion = await this.providerRouter.generate(prompt, input.selection);
      }
    }
  }

  private resolveSemanticIntent(
    question: string,
    explicitIntent?: SqlSemanticIntent,
    semanticPlan?: SemanticPlanV1
  ): SqlSemanticIntent {
    const routeKind = this.resolveSemanticPlanRouteKind(semanticPlan);
    if (routeKind === "metadata") {
      return "metadata";
    }
    if (explicitIntent && explicitIntent !== "general") {
      return explicitIntent;
    }
    if (METADATA_INTENT_REGEX.test(question)) {
      return "metadata";
    }
    if (COUNT_INTENT_REGEX.test(question)) {
      return "count";
    }
    return explicitIntent ?? "general";
  }

  private assertSemanticPlan(semanticPlan: SemanticPlanV1 | undefined): void {
    if (!semanticPlan) {
      return;
    }
    const routeKind = this.resolveSemanticPlanRouteKind(semanticPlan);
    if (semanticPlan.route === "reject" || routeKind === "fail_closed") {
      throw new DomainError(
        "SEMANTIC_PLAN_REJECTED",
        "语义计划路由为 reject，已终止 SQL 生成。",
        422,
        {
          semanticPlan
        }
      );
    }
    if (semanticPlan.route === "clarify" || routeKind === "clarify") {
      throw new DomainError(
        "SEMANTIC_PLAN_REQUIRES_CLARIFICATION",
        "语义计划要求先澄清问题，已终止 SQL 生成。",
        422,
        {
          semanticPlan
        }
      );
    }
  }

  private validateSemanticIntent(
    intent: SqlSemanticIntent,
    sql: string
  ): {
    valid: boolean;
    reason?: string;
  } {
    if (intent === "general") {
      return { valid: true };
    }

    if (intent === "count") {
      if (METADATA_SQL_REGEX.test(sql)) {
        return {
          valid: false,
          reason: "count-intent requires business counting SQL, but metadata introspection SQL was produced"
        };
      }
      if (!COUNT_SQL_REGEX.test(sql)) {
        return {
          valid: false,
          reason: "count-intent requires COUNT(...) aggregation"
        };
      }
      return { valid: true };
    }

    if (!METADATA_SQL_REGEX.test(sql)) {
      return {
        valid: false,
        reason:
          "metadata-intent requires schema/table introspection SQL (sqlite_master/information_schema/SHOW TABLES/pragma)"
      };
    }
    return { valid: true };
  }

  private validateEvidenceCoverage(input: {
    sql: string;
    semanticIntent: SqlSemanticIntent;
    selection: SqlGenerationSelection | undefined;
  }): {
    valid: boolean;
    reason?: string;
    evidence: SqlEvidenceCoverage;
  } {
    if (input.semanticIntent === "metadata") {
      return {
        valid: true,
        evidence: {
          gateStatus: "skipped_metadata_intent",
          missingObjects: [],
          triggerSource: "none",
          usedObjects: []
        }
      };
    }

    const evidenceIndex = this.buildCoverageEvidenceIndex(input.selection);
    const triggerSource = this.resolveCoverageTriggerSource(evidenceIndex);
    if (!evidenceIndex.hasEvidence) {
      return {
        valid: true,
        evidence: {
          gateStatus: "skipped_no_evidence",
          missingObjects: [],
          triggerSource,
          usedObjects: []
        }
      };
    }

    const references = this.extractSqlReferences(input.sql);
    const usedObjects = this.unique([
      ...Array.from(references.tables).map((table) => `table:${table}`),
      ...Array.from(references.tableColumns).map((tableColumn) => `column:${tableColumn}`),
      ...Array.from(references.columns).map((column) => `column:${column}`)
    ]);

    if (usedObjects.length === 0) {
      return {
        valid: true,
        evidence: {
          gateStatus: "skipped_no_sql_objects",
          missingObjects: [],
          triggerSource,
          usedObjects: []
        }
      };
    }

    const missingObjects = this.unique([
      ...Array.from(references.tables)
        .filter((table) => !evidenceIndex.tables.has(table))
        .map((table) => `table:${table}`),
      ...Array.from(references.tableColumns)
        .filter((tableColumn) => {
          const column = tableColumn.split(".")[1];
          return (
            !evidenceIndex.tableColumns.has(tableColumn) &&
            !evidenceIndex.columns.has(column)
          );
        })
        .map((tableColumn) => `column:${tableColumn}`),
      ...Array.from(references.columns)
        .filter(
          (column) =>
            !evidenceIndex.columns.has(column) &&
            !this.hasTableColumnFallback(evidenceIndex.tableColumns, column)
        )
        .map((column) => `column:${column}`)
    ]);

    if (missingObjects.length > 0) {
      const shouldEnforceBlock =
        evidenceIndex.hasExplicitPinning &&
        !evidenceIndex.hasSelectedContext &&
        !evidenceIndex.hasSemanticContext;
      if (!shouldEnforceBlock) {
        return {
          valid: true,
          evidence: {
            gateStatus: "failed",
            missingObjects,
            triggerSource,
            usedObjects
          }
        };
      }
      return {
        valid: false,
        reason: `missing evidence for ${missingObjects.join(", ")}`,
        evidence: {
          gateStatus: "failed",
          missingObjects,
          triggerSource,
          usedObjects
        }
      };
    }

    return {
      valid: true,
      evidence: {
        gateStatus: "passed",
        missingObjects: [],
        triggerSource,
        usedObjects
      }
    };
  }

  private validateSemanticPlanCoverage(input: {
    sql: string;
    semanticPlan: SemanticPlanV1 | undefined;
  }): {
    valid: boolean;
    reason?: string;
    missingObjects: string[];
  } {
    const semanticPlan = input.semanticPlan;
    if (!semanticPlan) {
      return {
        valid: true,
        missingObjects: []
      };
    }
    const routeKind = this.resolveSemanticPlanRouteKind(semanticPlan);
    if (routeKind === "metadata" || routeKind === "general") {
      return {
        valid: true,
        missingObjects: []
      };
    }
    if (routeKind === "clarify") {
      return {
        valid: false,
        reason: "semantic plan requires clarification before SQL generation",
        missingObjects: []
      };
    }
    if (routeKind === "fail_closed") {
      return {
        valid: false,
        reason: "semantic plan is in fail-closed route",
        missingObjects: []
      };
    }

    const references = this.extractSqlReferences(input.sql);
    const allowedTables = this.unique(
      (semanticPlan.allowedTables ?? [])
        .map((item) => this.normalizeIdentifier(item))
        .filter((item): item is string => Boolean(item))
    );
    const forbiddenTables = new Set(
      (semanticPlan.forbiddenTables ?? [])
        .map((item) => this.normalizeIdentifier(item))
        .filter((item): item is string => Boolean(item))
    );
    const selectedTables = this.unique(
      semanticPlan.selectedTables
        .map((item) => this.normalizeIdentifier(item))
        .filter((item): item is string => Boolean(item))
    );
    const selectedColumns = new Set(
      (semanticPlan.selectedColumns ?? [])
        .map((item) => this.normalizeQualifiedIdentifier(item))
        .filter((item): item is string => Boolean(item))
    );
    const selectedColumnNames = new Set(
      (semanticPlan.selectedColumns ?? [])
        .map((item) => {
          const normalized = this.normalizeQualifiedIdentifier(item);
          if (!normalized) {
            return undefined;
          }
          return normalized.split(".").at(-1);
        })
        .filter((item): item is string => Boolean(item))
    );

    const missingObjects = this.unique([
      ...Array.from(references.tables)
        .filter((table) => forbiddenTables.has(table))
        .map((table) => `table:${table}`),
      ...(allowedTables.length > 0
        ? Array.from(references.tables)
            .filter((table) => !allowedTables.includes(table))
            .map((table) => `table:${table}`)
        : []),
      ...(selectedTables.length > 0
        ? Array.from(references.tables)
            .filter((table) => !selectedTables.includes(table))
            .map((table) => `table:${table}`)
        : []),
      ...(selectedColumns.size > 0
        ? Array.from(references.tableColumns)
            .filter((tableColumn) => {
              if (selectedColumns.has(tableColumn)) {
                return false;
              }
              const columnName = tableColumn.split(".").at(-1);
              if (!columnName) {
                return true;
              }
              return !selectedColumnNames.has(columnName);
            })
            .map((tableColumn) => `column:${tableColumn}`)
        : [])
    ]);

    if (missingObjects.length > 0) {
      return {
        valid: false,
        reason: `semantic plan coverage missing: ${missingObjects.join(", ")}`,
        missingObjects
      };
    }

    return {
      valid: true,
      missingObjects: []
    };
  }

  private resolveSemanticPlanRouteKind(
    semanticPlan: SemanticPlanV1 | undefined
  ): "text_to_sql" | "metadata" | "general" | "clarify" | "fail_closed" {
    if (!semanticPlan) {
      return "text_to_sql";
    }
    const routeFilter = semanticPlan.filters?.find((item) =>
      item.startsWith("route_kind:")
    );
    if (routeFilter) {
      const value = routeFilter.slice("route_kind:".length).trim();
      if (
        value === "text_to_sql" ||
        value === "metadata" ||
        value === "general" ||
        value === "clarify" ||
        value === "fail_closed"
      ) {
        return value;
      }
    }
    if (semanticPlan.route === "clarify") {
      return "clarify";
    }
    if (semanticPlan.route === "reject") {
      return "fail_closed";
    }
    return "text_to_sql";
  }

  private buildCoverageEvidenceIndex(selection?: SqlGenerationSelection): {
    hasEvidence: boolean;
    tables: Set<string>;
    columns: Set<string>;
    tableColumns: Set<string>;
    hasSelectedContext: boolean;
    hasSemanticContext: boolean;
    hasExplicitPinning: boolean;
  } {
    const tables = new Set<string>();
    const columns = new Set<string>();
    const tableColumns = new Set<string>();
    const selectedContext = this.resolveSelectedContext(selection);
    let hasSelectedContext = false;
    for (const chunk of selectedContext ?? []) {
      const chunkTables = (chunk.metadata.tableNames ?? [])
        .map((item) => this.normalizeIdentifier(item))
        .filter((item): item is string => Boolean(item));
      const chunkColumns = (chunk.metadata.columnNames ?? [])
        .map((item) => this.normalizeIdentifier(item))
        .filter((item): item is string => Boolean(item));
      if (chunkTables.length > 0 || chunkColumns.length > 0) {
        hasSelectedContext = true;
      }
      for (const table of chunkTables) {
        tables.add(table);
      }
      for (const column of chunkColumns) {
        columns.add(column);
      }
      if (chunkTables.length === 1) {
        const table = chunkTables[0];
        for (const column of chunkColumns) {
          tableColumns.add(`${table}.${column}`);
        }
      }
    }

    const semanticEvidence = this.extractSemanticEvidence(selection?.semanticContextPack);
    for (const table of semanticEvidence.tables) {
      tables.add(table);
    }
    for (const column of semanticEvidence.columns) {
      columns.add(column);
    }
    for (const tableColumn of semanticEvidence.tableColumns) {
      tableColumns.add(tableColumn);
    }

    const explicitPinning = selection?.explicitPinning;
    const explicitTables = (explicitPinning?.tables ?? [])
      .map((item) => this.normalizeIdentifier(item))
      .filter((item): item is string => Boolean(item));
    const explicitColumns = (explicitPinning?.columns ?? [])
      .map((item) => this.normalizeIdentifier(item))
      .filter((item): item is string => Boolean(item));
    const hasExplicitPinning = explicitTables.length > 0 || explicitColumns.length > 0;
    for (const table of explicitTables) {
      tables.add(table);
    }
    for (const column of explicitColumns) {
      columns.add(column);
      if (column.includes(".")) {
        const [table, field] = column.split(".");
        if (table && field) {
          tables.add(table);
          columns.add(field);
          tableColumns.add(`${table}.${field}`);
        }
      }
    }

    return {
      hasEvidence: hasSelectedContext || semanticEvidence.hasSemanticContext || hasExplicitPinning,
      tables,
      columns,
      tableColumns,
      hasSelectedContext,
      hasSemanticContext: semanticEvidence.hasSemanticContext,
      hasExplicitPinning
    };
  }

  private extractSemanticEvidence(contextPack?: RagContextPack): {
    hasSemanticContext: boolean;
    tables: Set<string>;
    columns: Set<string>;
    tableColumns: Set<string>;
  } {
    const tables = new Set<string>();
    const columns = new Set<string>();
    const tableColumns = new Set<string>();
    if (!contextPack || contextPack.status === "degraded") {
      return {
        hasSemanticContext: false,
        tables,
        columns,
        tableColumns
      };
    }

    const contextPackCompat = contextPack as RagContextPack & {
      semanticBindings?: RagContextPack["semantic_bindings"];
      instructionSets?: RagContextPack["instruction_sets"];
    };
    const semanticBindingsRecord = (contextPack.semantic_bindings ??
      contextPackCompat.semanticBindings) as unknown as
      | Record<string, unknown>
      | undefined;
    const instructionSetsRecord = (contextPack.instruction_sets ??
      contextPackCompat.instructionSets) as unknown as
      | Record<string, unknown>
      | undefined;
    const candidates = this.unique([
      ...this.readStringArray(semanticBindingsRecord?.model_keys),
      ...this.readStringArray(semanticBindingsRecord?.relationship_keys),
      ...this.readStringArray(semanticBindingsRecord?.metric_keys),
      ...this.readStringArray(semanticBindingsRecord?.calculated_field_keys),
      ...this.readStringArray(instructionSetsRecord?.model_bindings),
      ...this.readStringArray(instructionSetsRecord?.relationship_bindings),
      ...this.readStringArray(instructionSetsRecord?.metric_bindings),
      ...this.readStringArray(instructionSetsRecord?.calculated_field_bindings)
    ]);

    for (const candidate of candidates) {
      for (const pair of this.extractQualifiedPairs(candidate)) {
        tables.add(pair.table);
        columns.add(pair.column);
        tableColumns.add(`${pair.table}.${pair.column}`);
      }
      const modelMatch = /(?:^|[^\w])(model|table)[.:]([a-zA-Z_][\w$]*)/i.exec(candidate);
      if (modelMatch?.[2]) {
        const table = this.normalizeIdentifier(modelMatch[2]);
        if (table) {
          tables.add(table);
        }
      }
    }

    return {
      hasSemanticContext: candidates.length > 0,
      tables,
      columns,
      tableColumns
    };
  }

  private resolveCoverageTriggerSource(input: {
    hasSelectedContext: boolean;
    hasSemanticContext: boolean;
    hasExplicitPinning: boolean;
  }): SqlCoverageTriggerSource {
    if (input.hasExplicitPinning) {
      return "explicit_pinning";
    }
    if (input.hasSelectedContext) {
      return "selected_context";
    }
    if (input.hasSemanticContext) {
      return "semantic_context";
    }
    return "none";
  }

  private extractSqlReferences(sql: string): {
    tables: Set<string>;
    columns: Set<string>;
    tableColumns: Set<string>;
  } {
    const tables = new Set<string>();
    const columns = new Set<string>();
    const tableColumns = new Set<string>();
    const cteNames = new Set<string>();
    const cteRegex = new RegExp(SQL_CTE_REGEX.source, "gi");
    for (const match of sql.matchAll(cteRegex)) {
      const cteName = this.normalizeIdentifier(match[1]);
      if (cteName) {
        cteNames.add(cteName);
      }
    }

    const tableRegex = new RegExp(SQL_TABLE_REF_REGEX.source, "gi");
    for (const match of sql.matchAll(tableRegex)) {
      const table = this.normalizeIdentifier(match[1]);
      if (!table || cteNames.has(table)) {
        continue;
      }
      tables.add(table);
    }

    const qualifiedRegex = new RegExp(SQL_QUALIFIED_COLUMN_REGEX.source, "gi");
    for (const match of sql.matchAll(qualifiedRegex)) {
      const table = this.normalizeIdentifier(match[1]);
      const column = this.normalizeIdentifier(match[2]);
      if (!table || !column) {
        continue;
      }
      if (!cteNames.has(table)) {
        tables.add(table);
      }
      columns.add(column);
      tableColumns.add(`${table}.${column}`);
    }

    for (const column of this.extractSimpleSelectColumns(sql)) {
      columns.add(column);
    }

    return { tables, columns, tableColumns };
  }

  private extractSimpleSelectColumns(sql: string): string[] {
    const selectMatch = /\bselect\b([\s\S]*?)\bfrom\b/i.exec(sql);
    if (!selectMatch?.[1]) {
      return [];
    }
    const chunks = selectMatch[1].split(",");
    const parsed: string[] = [];
    for (const chunk of chunks) {
      let candidate = chunk.trim();
      if (!candidate || candidate === "*") {
        continue;
      }
      if (candidate.includes(".") || candidate.includes("(")) {
        continue;
      }
      candidate = candidate.replace(/\bas\s+[a-zA-Z_][\w$]*$/i, "").trim();
      candidate = candidate.replace(/^distinct\s+/i, "").trim();
      const match = /^([a-zA-Z_][\w$]*)/.exec(candidate);
      if (!match?.[1]) {
        continue;
      }
      const normalized = this.normalizeIdentifier(match[1]);
      if (normalized) {
        parsed.push(normalized);
      }
    }
    return this.unique(parsed);
  }

  private extractQualifiedPairs(value: string): Array<{ table: string; column: string }> {
    const normalized = value.replace(/->/g, " ").replace(/:/g, " ");
    const regex = new RegExp(SQL_QUALIFIED_COLUMN_REGEX.source, "gi");
    const pairs: Array<{ table: string; column: string }> = [];
    for (const match of normalized.matchAll(regex)) {
      const table = this.normalizeIdentifier(match[1]);
      const column = this.normalizeIdentifier(match[2]);
      if (!table || !column) {
        continue;
      }
      if (["model", "table", "metric", "relationship", "calculated"].includes(table)) {
        continue;
      }
      pairs.push({ table, column });
    }
    return pairs;
  }

  private normalizeIdentifier(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value
      .trim()
      .replace(/^[`"'[\]]+|[`"'[\]]+$/g, "")
      .replace(/\s+/g, "");
    if (!normalized) {
      return undefined;
    }
    const token = normalized.includes(".")
      ? normalized.split(".").at(-1)
      : normalized;
    return token?.toLowerCase();
  }

  private normalizeQualifiedIdentifier(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value
      .trim()
      .replace(/^[`"'[\]]+|[`"'[\]]+$/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (!normalized.includes(".")) {
      return normalized;
    }
    const [table, column] = normalized.split(".");
    if (!table || !column) {
      return undefined;
    }
    return `${table}.${column}`;
  }

  private normalizeList(values: string[]): string[] {
    return this.unique(
      values
        .map((value) => this.normalizeQualifiedIdentifier(value))
        .filter((value): value is string => Boolean(value))
    );
  }

  private hasTableColumnFallback(
    tableColumns: Set<string>,
    column: string
  ): boolean {
    for (const tableColumn of tableColumns) {
      if (tableColumn.endsWith(`.${column}`)) {
        return true;
      }
    }
    return false;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item): item is string => item.length > 0);
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values));
  }

  private async resolvePromptTemplate(selection?: {
    datasourceId?: string;
    workspaceId?: string;
  }): Promise<{
    templateOverlay?: string;
    evidence: PromptTemplateTraceEvidence;
  }> {
    try {
      const resolved = await this.promptTemplateService.resolveSqlTemplateRuntime({
        datasourceId: selection?.datasourceId,
        workspaceId: selection?.workspaceId
      });
      return {
        templateOverlay: resolved.template?.content,
        evidence: resolved.evidence
      };
    } catch {
      return {
        evidence: {
          scene: "sql",
          fallbackReason: "template_service_error"
        }
      };
    }
  }
}
