import { Injectable } from "@nestjs/common";
import type {
  DatasourceType,
  PromptTemplateTraceEvidence,
  SemanticPlanV1
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
}

export interface SqlGenerationExplicitPinningEvidence {
  source?: string;
  tables?: string[];
  columns?: string[];
}

const MAX_SEMANTIC_REPAIR_RETRY = 1;
const COUNT_INTENT_REGEX =
  /(多少|几条|几笔|总数|数量|计数|count|人数|单量|订单量|客户数|用户数)/i;
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
    private readonly promptTemplateService: PromptTemplateService
  ) {}

  async generate(
    question: string,
    selection?: SqlGenerationSelection
  ): Promise<SqlDraft> {
    const templateResolution = await this.resolvePromptTemplate(selection);
    const semanticIntent = this.resolveSemanticIntent(
      question,
      selection?.semanticIntent
    );
    const prompt = this.buildPrompt(
      question,
      selection,
      templateResolution.templateOverlay,
      semanticIntent
    );
    const completion = await this.providerRouter.generate(prompt, selection);
    return this.finalizeWithSemanticGuardrails({
      question,
      selection,
      semanticIntent,
      prompt,
      completion,
      templateOverlay: templateResolution.templateOverlay,
      promptTemplate: templateResolution.evidence
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
      selection?.semanticIntent
    );
    const prompt = this.buildPrompt(
      question,
      selection,
      templateResolution.templateOverlay,
      semanticIntent
    );
    let completion: LlmDraft;
    try {
      completion = await this.providerRouter.stream(prompt, selection, options);
    } catch (error) {
      if (!this.shouldRetryAsNonStream(error)) {
        throw error;
      }

      completion = await this.providerRouter.generate(prompt, selection);
    }
    return this.finalizeWithSemanticGuardrails({
      question,
      selection,
      semanticIntent,
      prompt,
      completion,
      templateOverlay: templateResolution.templateOverlay,
      promptTemplate: templateResolution.evidence
    });
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

  private buildPrompt(
    question: string,
    selection: SqlGenerationSelection | undefined,
    templateOverlay: string | undefined,
    semanticIntent: SqlSemanticIntent,
    retryReason?: string
  ): LlmGatewayPrompt {
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
        semanticPlan: selection?.semanticPlan
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
          "no executable SQL was extracted from the previous output"
        );
        completion = await this.providerRouter.generate(prompt, input.selection);
      }
    }
  }

  private resolveSemanticIntent(
    question: string,
    explicitIntent?: SqlSemanticIntent
  ): SqlSemanticIntent {
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
    if (semanticPlan.route === "reject") {
      throw new DomainError(
        "SEMANTIC_PLAN_REJECTED",
        "语义计划路由为 reject，已终止 SQL 生成。",
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

    const missingObjects = this.unique([
      ...Array.from(references.tables)
        .filter((table) => forbiddenTables.has(table))
        .map((table) => `table:${table}`),
      ...(allowedTables.length > 0
        ? Array.from(references.tables)
            .filter((table) => !allowedTables.includes(table))
            .map((table) => `table:${table}`)
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
