import { Injectable, Optional } from "@nestjs/common";
import type {
  DatasourceType,
  SemanticPlanV1,
  SqlGenerationArtifactV1,
  SqlValidationArtifactV1,
  SqlValidationCheckV1
} from "@text2sql/shared-types";
import {
  QueryExecutorRouterService,
  SqlCatalogResolverService,
  SqlDialectAnalyzerService,
  SqliteQueryService,
  type SqlAnalysisResult,
  type SqlCatalogResolutionResult,
  type SqlTableAccessContext
} from "../../platform/data/query";
import type { DatasourceSchemaSnapshotV1 } from "../../platform/data/schema/schema-snapshot.types";
import { RelationshipDryRunService } from "../../platform/data/query/relationship-dry-run.service";
import { DomainError } from "../../../common/domain-error";
import { DatasourceService } from "../../governance/datasource/datasource.service";

interface ValidateSqlInput {
  sql: string;
  datasourceId?: string;
  datasourceType?: DatasourceType;
  semanticPlan?: SemanticPlanV1;
  sqlArtifact?: SqlGenerationArtifactV1;
  accessContext?: SqlTableAccessContext;
  allowedTables?: string[];
  schemaSnapshot?: DatasourceSchemaSnapshotV1;
  requiresCatalog?: boolean;
}

type RouteKind = "text_to_sql" | "metadata" | "general" | "clarify" | "fail_closed";
export type SqlValidationOutcome = "pass" | "correctable" | "terminal";

@Injectable()
export class SqlValidationService {
  constructor(
    @Optional()
    private readonly queryExecutorRouter?: QueryExecutorRouterService,
    @Optional()
    private readonly relationshipDryRunService?: RelationshipDryRunService,
    @Optional()
    private readonly datasourceService?: DatasourceService,
    @Optional()
    private readonly sqliteQuery?: SqliteQueryService,
    @Optional()
    private readonly sqlAnalyzer: SqlDialectAnalyzerService = new SqlDialectAnalyzerService(),
    @Optional()
    private readonly catalogResolver: SqlCatalogResolverService = new SqlCatalogResolverService()
  ) {}

  async validate(input: ValidateSqlInput): Promise<SqlValidationArtifactV1> {
    const checks: SqlValidationCheckV1[] = [];
    const sql = input.sql.trim();
    const routeKind = this.resolveRouteKind(input.semanticPlan);
    const datasourceType = input.datasourceType ?? "sqlite";
    const requiresAst =
      datasourceType === "sqlite" ||
      datasourceType === "mysql" ||
      datasourceType === "postgresql" ||
      Boolean(input.requiresCatalog);
    const analysis = this.sqlAnalyzer.analyze({ sql, datasourceType });
    const catalogResolution = this.catalogResolver.resolve({
      analysis,
      schemaSnapshot: input.schemaSnapshot,
      requireSnapshot: input.requiresCatalog
    });

    const readOnlyStatus = this.validateReadOnly(sql, analysis);
    checks.push(readOnlyStatus);

    const parseStatus = this.validateParse(sql, analysis, requiresAst);
    checks.push(parseStatus);
    checks.push(
      this.validateStructural(
        analysis,
        requiresAst
      )
    );
    checks.push(this.validateCatalog(catalogResolution, Boolean(input.requiresCatalog)));

    const permissionStatus = this.validatePermission({
      analysis,
      catalogResolution,
      semanticPlan: input.semanticPlan,
      accessContext: input.accessContext,
      allowedTables: input.allowedTables
    });
    checks.push(permissionStatus);

    const planCoverage = this.validatePlanCoverage({
      analysis,
      semanticPlan: input.semanticPlan,
      routeKind
    });
    checks.push(planCoverage);

    checks.push(this.validateRelationshipPath(analysis, input.semanticPlan));
    const ledgerFulfillment = this.validateLedgerFulfillment({
      sql,
      analysis,
      semanticPlan: input.semanticPlan,
      sqlArtifact: input.sqlArtifact
    });
    checks.push(ledgerFulfillment.check);
    checks.push(this.validateDialect(analysis, requiresAst));
    checks.push(
      await this.validateDryRun({
        sql,
        datasourceId: input.datasourceId,
        datasourceType: input.datasourceType,
        parseStatus,
        readOnlyStatus
      })
    );
    checks.push(
      this.validateDryPlan({
        sql,
        semanticPlan: input.semanticPlan,
        routeKind,
        datasourceType: input.datasourceType
      })
    );

    const failedChecks = checks.filter((check) => check.status === "failed");
    if (failedChecks.length === 0) {
      return {
        status: "passed",
        checks,
        correctable: false,
        ledgerFulfillment: ledgerFulfillment.summary,
        sqlAnalysis: this.toSafeAnalysisEvidence(analysis, catalogResolution),
        catalogResolution: this.toSafeCatalogEvidence(catalogResolution)
      };
    }

    const failure = this.selectPrimaryFailure(failedChecks);
    const correctable = this.isCorrectableFailure(failure.check, failure.code);
    const failedObligationIds = this.unique(
      failedChecks.flatMap((check) => check.failedObligationIds ?? [])
    );
    return {
      status: "failed",
      checks,
      correctable,
      ledgerFulfillment: ledgerFulfillment.summary,
      sqlAnalysis: this.toSafeAnalysisEvidence(analysis, catalogResolution),
      catalogResolution: this.toSafeCatalogEvidence(catalogResolution),
      ...(failedObligationIds.length > 0 ? { failedObligationIds } : {}),
      ...(correctable
        ? { correctableObligationIds: failedObligationIds }
        : failedObligationIds.length > 0
          ? { terminalObligationIds: failedObligationIds }
          : {}),
      failure: {
        code: failure.code ?? "SQL_VALIDATION_FAILED",
        message: failure.message ?? "SQL validation failed",
        category: this.toFailureCategory(failure.check, failure.code),
        terminal: !correctable,
        correctable
      }
    };
  }

  resolveOutcome(artifact: SqlValidationArtifactV1): SqlValidationOutcome {
    if (artifact.status === "passed") {
      return "pass";
    }
    if (artifact.status === "failed" && artifact.correctable && !artifact.failure?.terminal) {
      return "correctable";
    }
    return "terminal";
  }

  private validateParse(
    sql: string,
    analysis: SqlAnalysisResult,
    requiresAst: boolean
  ): SqlValidationCheckV1 {
    if (!sql) {
      return {
        check: "parse",
        status: "failed",
        code: "SQL_PARSE_EMPTY",
        message: "SQL 不能为空"
      };
    }
    const statementWithoutTailSemicolon = sql.replace(/;+\s*$/, "");
    if (statementWithoutTailSemicolon.includes(";")) {
      return {
        check: "parse",
        status: "failed",
        code: "SQL_PARSE_MULTI_STATEMENT",
        message: "仅支持单条只读 SQL 查询"
      };
    }
    const normalized = statementWithoutTailSemicolon.toLowerCase();
    if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
      return {
        check: "parse",
        status: "failed",
        code: "SQL_PARSE_UNSUPPORTED_STATEMENT",
        message: "仅支持 SELECT 或 WITH 查询"
      };
    }
    if (
      analysis.status !== "ready" &&
      requiresAst &&
      (analysis.statementCount === 0 ||
        analysis.diagnostics.some((diagnostic) => diagnostic.category === "parse"))
    ) {
      return {
        check: "parse",
        status: "failed",
        code: analysis.diagnostics[0]?.code ?? "SQL_ANALYSIS_PARSE_FAILED",
        message: "SQL AST parser could not produce a trusted parse result."
      };
    }
    return {
      check: "parse",
      status: "passed"
    };
  }

  private validateReadOnly(
    sql: string,
    analysis: SqlAnalysisResult
  ): SqlValidationCheckV1 {
    if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|replace|merge)\b/i.test(sql)) {
      return {
        check: "read-only",
        status: "failed",
        code: "SQL_READ_ONLY_VIOLATION",
        message: "检测到写操作或 DDL，已阻止执行"
      };
    }
    if (analysis.readOnly && analysis.statementTypes.every((type) => type === "select")) {
      return {
        check: "read-only",
        status: "passed"
      };
    }
    if (analysis.status === "failed" && analysis.statementTypes.length > 0) {
      return {
        check: "read-only",
        status: "failed",
        code: analysis.diagnostics[0]?.code ?? "SQL_READ_ONLY_VIOLATION",
        message: "SQL AST cannot prove a read-only statement."
      };
    }
    return {
      check: "read-only",
      status: "skipped",
      message: "read-only proof unavailable because structural analysis did not complete"
    };
  }

  private validateStructural(
    analysis: SqlAnalysisResult,
    required: boolean
  ): SqlValidationCheckV1 {
    if (analysis.status === "ready" && analysis.readOnly) {
      return {
        check: "structural",
        status: "passed",
        reasonCodes: ["ast_parse_ready", "ast_read_only_proven"]
      };
    }
    if (!required && analysis.status === "unavailable") {
      return {
        check: "structural",
        status: "skipped",
        code: "SQL_ANALYSIS_DIALECT_UNAVAILABLE",
        message: "AST analysis is not required for this compatibility path.",
        reasonCodes: analysis.diagnostics.map((diagnostic) => diagnostic.code)
      };
    }
    return {
      check: "structural",
      status: "failed",
      code: analysis.diagnostics[0]?.code ?? "SQL_ANALYSIS_UNAVAILABLE",
      message: "SQL structural analysis is unavailable or failed.",
      reasonCodes: analysis.diagnostics.map((diagnostic) => diagnostic.code)
    };
  }

  private validateCatalog(
    resolution: SqlCatalogResolutionResult,
    required: boolean
  ): SqlValidationCheckV1 {
    if (resolution.status === "resolved") {
      return {
        check: "catalog",
        status: "passed",
        reasonCodes: ["frozen_catalog_resolved"]
      };
    }
    if (!required && resolution.status === "unavailable") {
      return {
        check: "catalog",
        status: "skipped",
        code: "SQL_CATALOG_SNAPSHOT_NOT_REQUIRED",
        message: "Frozen catalog resolution was not required for this compatibility path.",
        reasonCodes: resolution.reasonCodes
      };
    }
    return {
      check: "catalog",
      status: "failed",
      code:
        resolution.reasonCodes.includes("schema_snapshot_unavailable")
          ? "SQL_CATALOG_SNAPSHOT_UNAVAILABLE"
          : resolution.reasonCodes.includes("catalog_reference_ambiguous")
            ? "SQL_CATALOG_REFERENCE_AMBIGUOUS"
            : "SQL_CATALOG_RESOLUTION_FAILED",
      message: "SQL references could not be resolved against the frozen authorized catalog.",
      reasonCodes: resolution.reasonCodes
    };
  }

  private validatePermission(input: {
    analysis: SqlAnalysisResult;
    catalogResolution: SqlCatalogResolutionResult;
    semanticPlan?: SemanticPlanV1;
    accessContext?: SqlTableAccessContext;
    allowedTables?: string[];
  }): SqlValidationCheckV1 {
    const allowedTables = new Set(
      this.normalizeList([
        ...(input.allowedTables ?? []),
        ...(input.semanticPlan?.allowedTables ?? []),
        ...(input.accessContext?.allowedTables ?? [])
      ])
    );
    const forbiddenTables = new Set(this.normalizeList(input.semanticPlan?.forbiddenTables ?? []));

    const tables =
      input.catalogResolution.status === "resolved"
        ? input.catalogResolution.tables
        : input.analysis.tables.map((table) => table.normalizedName);
    const denied = tables.filter((table) => forbiddenTables.has(table));
    if (denied.length > 0) {
      return {
        check: "permission",
        status: "failed",
        code: "SQL_TABLE_PERMISSION_DENIED",
        message: "SQL 引用了语义计划明确禁止的表。"
      };
    }

    if (allowedTables.size > 0) {
      const outsideAllowed = tables.filter((table) => !allowedTables.has(table));
      if (outsideAllowed.length > 0) {
        return {
          check: "permission",
          status: "failed",
          code: "SQL_TABLE_PERMISSION_DENIED",
          message: "SQL 引用了当前工作空间未授权的表。"
        };
      }
    }

    const selectedColumns = new Set(
      this.normalizeList(input.semanticPlan?.selectedColumns ?? []).filter((column) =>
        column.includes(".")
      )
    );
    if (selectedColumns.size > 0) {
      const referenced =
        input.catalogResolution.status === "resolved"
          ? input.catalogResolution.columns.map((column) => column.qualifiedName)
          : input.analysis.columns
              .filter((column) => !column.wildcard)
              .map((column) =>
                column.table || tables.length !== 1
                  ? column.normalizedName
                  : `${tables[0]}.${column.name}`
              );
      const outsideColumns = referenced.filter((column) => !selectedColumns.has(column));
      if (outsideColumns.length > 0) {
        return {
          check: "permission",
          status: "failed",
          code: "SQL_COLUMN_PERMISSION_DENIED",
          message: "SQL 引用了语义计划或授权 Catalog 之外的字段。"
        };
      }
    }

    if (allowedTables.size === 0) {
      return {
        check: "permission",
        status: "skipped",
        message: "permission check skipped: allowed tables not configured"
      };
    }

    return {
      check: "permission",
      status: "passed"
    };
  }

  private validatePlanCoverage(input: {
    analysis: SqlAnalysisResult;
    semanticPlan?: SemanticPlanV1;
    routeKind: RouteKind;
  }): SqlValidationCheckV1 {
    const semanticPlan = input.semanticPlan;
    if (!semanticPlan) {
      return {
        check: "plan-coverage",
        status: "skipped",
        message: "plan coverage skipped: semantic plan missing"
      };
    }

    if (semanticPlan.route === "reject" || input.routeKind === "fail_closed") {
      return {
        check: "plan-coverage",
        status: "failed",
        code: "SQL_PLAN_FAIL_CLOSED",
        message: "语义计划已进入 fail-closed 路径，禁止执行 SQL"
      };
    }
    if (semanticPlan.route === "clarify" || input.routeKind === "clarify") {
      return {
        check: "plan-coverage",
        status: "failed",
        code: "SQL_PLAN_REQUIRES_CLARIFICATION",
        message: "语义计划要求先澄清问题，禁止直接执行 SQL"
      };
    }
    if (input.routeKind === "metadata" || input.routeKind === "general") {
      return {
        check: "plan-coverage",
        status: "passed",
        message: "non text-to-sql route"
      };
    }

    const selectedTables = new Set(this.normalizeList(semanticPlan.selectedTables));
    if (selectedTables.size === 0) {
      return {
        check: "plan-coverage",
        status: "failed",
        code: "SQL_PLAN_MISSING_SELECTED_TABLES",
        message: "语义计划缺少 selectedTables，无法放行执行"
      };
    }

    const tables = input.analysis.tables.map((table) => table.normalizedName);
    const outsidePlan = tables.filter((table) => !selectedTables.has(table));
    if (outsidePlan.length > 0) {
      return {
        check: "plan-coverage",
        status: "failed",
        code: "SQL_PLAN_COVERAGE_OUTSIDE_SELECTED_TABLES",
        message: "SQL 使用了 QueryContract 计划范围之外的表。"
      };
    }

    return {
      check: "plan-coverage",
      status: "passed"
    };
  }

  private validateRelationshipPath(
    analysis: SqlAnalysisResult,
    semanticPlan?: SemanticPlanV1
  ): SqlValidationCheckV1 {
    const joinPath = this.normalizeJoinPath(semanticPlan?.joinPath ?? []);
    const selectedTables = this.normalizeList(semanticPlan?.selectedTables ?? []);
    if (joinPath.length === 0 && selectedTables.length <= 1) {
      return {
        check: "relationship-path",
        status: "skipped"
      };
    }

    const sqlUsesJoin = analysis.tables.length > 1;
    if (!sqlUsesJoin && selectedTables.length > 1) {
      return {
        check: "relationship-path",
        status: "failed",
        code: "SQL_RELATIONSHIP_PATH_MISSING_JOIN",
        message: "语义计划包含多表绑定，但 SQL 未使用 JOIN"
      };
    }

    const referencedTables = analysis.tables.map((table) => table.normalizedName);
    const missingTables = selectedTables.filter((table) => !referencedTables.includes(table));
    if (missingTables.length > 0) {
      return {
        check: "relationship-path",
        status: "failed",
        code: "SQL_RELATIONSHIP_PATH_MISMATCH",
        message: "SQL 未覆盖语义计划要求的完整关联表集合。"
      };
    }

    return {
      check: "relationship-path",
      status: "passed"
    };
  }

  private validateLedgerFulfillment(input: {
    sql: string;
    analysis: SqlAnalysisResult;
    semanticPlan?: SemanticPlanV1;
    sqlArtifact?: SqlGenerationArtifactV1;
  }): { check: SqlValidationCheckV1; summary?: SqlValidationArtifactV1["ledgerFulfillment"] } {
    const ledger = input.semanticPlan?.planLedger;
    if (!ledger) {
      return {
        check: {
          check: "ledger-fulfillment",
          status: "skipped",
          message: "ledger fulfillment skipped: semantic plan ledger missing"
        }
      };
    }

    const tables = input.analysis.tables.map((table) => table.normalizedName);
    const tableColumns = input.analysis.columns
      .filter((column) => !column.wildcard)
      .map((column) => column.normalizedName);
    const columns = this.unique([
      ...tableColumns.map((column) => column.split(".").at(-1) ?? column),
      ...this.extractSimpleSelectColumns(input.sql),
      ...(input.sqlArtifact?.usedColumns ?? []).map((column) =>
        this.normalizeQualifiedIdentifier(column)?.split(".").at(-1) ?? ""
      )
    ]);
    const claimedObligationIds = new Set(input.sqlArtifact?.claimedObligationIds ?? []);
    const failed: Array<{ id: string; reasonCode: string; terminal: boolean }> = [];

    for (const obligation of ledger.obligations) {
      if (obligation.criticality !== "hard_blocker") {
        continue;
      }
      if (claimedObligationIds.has(obligation.id)) {
        continue;
      }
      const subject = obligation.subject;
      const normalizedSubject = this.normalizeIdentifier(subject);
      const qualifiedSubject = this.normalizeQualifiedIdentifier(subject);
      const fail = (reasonCode: string, terminal = false) => {
        failed.push({ id: obligation.id, reasonCode, terminal });
      };
      if (obligation.kind === "forbidden_table" || obligation.kind === "permission") {
        if (normalizedSubject && tables.includes(normalizedSubject)) {
          fail("ledger_terminal_permission_obligation", true);
        }
        continue;
      }
      if (obligation.status === "failed" || obligation.status === "unsupported") {
        fail(obligation.reasonCodes[0] ?? "ledger_pre_generation_obligation_failed");
        continue;
      }
      if (obligation.kind === "table" && normalizedSubject && !tables.includes(normalizedSubject)) {
        fail("ledger_table_not_used");
      }
      if (
        obligation.kind === "column" &&
        qualifiedSubject &&
        !tableColumns.includes(qualifiedSubject) &&
        (!normalizedSubject || !columns.includes(normalizedSubject))
      ) {
        fail("ledger_column_not_used");
      }
      if (
        obligation.kind === "metric" &&
        normalizedSubject &&
        !new RegExp(`\\b${this.escapeRegex(normalizedSubject)}\\b`, "i").test(input.sql) &&
        !/\b(count|sum|avg|min|max)\s*\(/i.test(input.sql)
      ) {
        fail("ledger_metric_not_claimed");
      }
      if (
        obligation.kind === "time_grain" &&
        !/\b(date_trunc|strftime|extract|group\s+by|where)\b/i.test(input.sql)
      ) {
        fail("ledger_time_grain_not_used");
      }
      if (obligation.kind === "filter" && !/\bwhere\b/i.test(input.sql)) {
        fail("ledger_filter_not_used");
      }
      if (obligation.kind === "join_path" && !/\bjoin\b/i.test(input.sql)) {
        fail("ledger_join_path_not_used");
      }
    }

    for (const claim of input.sqlArtifact?.unsupportedClaims ?? []) {
      failed.push({
        id: `unsupported:${claim.kind}:${claim.value}`,
        reasonCode: claim.reasonCode,
        terminal: true
      });
    }

    const failedObligationIds = this.unique(failed.map((item) => item.id));
    const terminal = failed.some((item) => item.terminal);
    const reasonCodes = this.unique(failed.map((item) => item.reasonCode));
    const summary = {
      ...ledger.summary,
      fulfilledCount: Math.max(0, ledger.summary.total - failedObligationIds.length),
      failedCount: failedObligationIds.length,
      failedHardBlockerIds: failedObligationIds.filter((id) => !id.startsWith("unsupported:")),
      unsupportedCount: failedObligationIds.filter((id) => id.startsWith("unsupported:")).length,
      reasonCodes: reasonCodes.length > 0 ? reasonCodes : ledger.summary.reasonCodes
    };

    if (failedObligationIds.length === 0) {
      return {
        check: {
          check: "ledger-fulfillment",
          status: "passed",
          obligationIds: ledger.obligations.map((obligation) => obligation.id),
          reasonCodes: ["ledger_fulfilled"]
        },
        summary
      };
    }

    return {
      check: {
        check: "ledger-fulfillment",
        status: "failed",
        code: terminal
          ? "SQL_LEDGER_TERMINAL_OBLIGATION_FAILED"
          : "SQL_LEDGER_FULFILLMENT_FAILED",
        message: terminal
          ? "SQL contains terminal ledger violations"
          : "SQL does not fulfill all required ledger obligations",
        obligationIds: ledger.obligations.map((obligation) => obligation.id),
        failedObligationIds,
        reasonCodes
      },
      summary
    };
  }

  private validateDialect(
    analysis: SqlAnalysisResult,
    required: boolean
  ): SqlValidationCheckV1 {
    if (analysis.status === "ready" && analysis.dialect) {
      return {
        check: "dialect",
        status: "passed",
        reasonCodes: [`dialect_ast:${analysis.dialect}`]
      };
    }
    if (!required && analysis.status === "unavailable") {
      return {
        check: "dialect",
        status: "skipped",
        code: "SQL_DIALECT_UNAVAILABLE",
        message: "Target datasource does not use a supported SQL AST dialect.",
        reasonCodes: analysis.diagnostics.map((diagnostic) => diagnostic.code)
      };
    }
    return {
      check: "dialect",
      status: "failed",
      code:
        analysis.status === "unavailable"
          ? "SQL_DIALECT_UNAVAILABLE"
          : "SQL_DIALECT_MISMATCH",
      message: "SQL could not be proven valid for the target datasource dialect.",
      reasonCodes: analysis.diagnostics.map((diagnostic) => diagnostic.code)
    };
  }

  private validateDryRun(input: {
    sql: string;
    datasourceId?: string;
    datasourceType?: DatasourceType;
    parseStatus: SqlValidationCheckV1;
    readOnlyStatus: SqlValidationCheckV1;
  }): Promise<SqlValidationCheckV1> {
    if (input.parseStatus.status === "failed" || input.readOnlyStatus.status === "failed") {
      return Promise.resolve({
        check: "dry-run",
        status: "skipped",
        message: "dry-run skipped because parse/read-only check already failed"
      });
    }

    const capability = this.resolveDryRunCapability(input.datasourceType);
    if (!capability.supported) {
      return Promise.resolve({
        check: "dry-run",
        status: "skipped",
        code: "SQL_DRY_RUN_UNSUPPORTED",
        message: capability.reason
      });
    }

    const dryPlan = this.queryExecutorRouter?.buildDryPlan(
      input.sql,
      input.datasourceType
    );
    if (dryPlan && !dryPlan.complete) {
      return Promise.resolve({
        check: "dry-run",
        status: "failed",
        code: "SQL_DRY_RUN_PARSE_REJECTED",
        message: dryPlan.reason ?? "dry-run parse rejected"
      });
    }

    return this.executeSqliteDryRun(input).then((failure) => {
      if (failure) {
        return failure;
      }
      return {
        check: "dry-run",
        status: "passed"
      };
    });
  }

  private validateDryPlan(input: {
    sql: string;
    semanticPlan?: SemanticPlanV1;
    routeKind: RouteKind;
    datasourceType?: DatasourceType;
  }): SqlValidationCheckV1 {
    if (!input.semanticPlan) {
      return {
        check: "dry-plan",
        status: "skipped",
        message: "dry-plan skipped: semantic plan missing"
      };
    }
    if (input.routeKind === "metadata" || input.routeKind === "general") {
      return {
        check: "dry-plan",
        status: "skipped",
        message: "dry-plan skipped: non text-to-sql route"
      };
    }

    const capability = this.resolveDryPlanCapability(input.datasourceType);
    if (!capability.supported) {
      return {
        check: "dry-plan",
        status: "skipped",
        code: "SQL_DRY_PLAN_UNSUPPORTED",
        message: capability.reason
      };
    }

    const dryPlanSnapshot = this.relationshipDryRunService?.evaluateJoinPathConsistency({
      sql: input.sql,
      selectedTables: input.semanticPlan.selectedTables,
      joinPath: input.semanticPlan.joinPath
    });
    if (dryPlanSnapshot && !dryPlanSnapshot.pass) {
      return {
        check: "dry-plan",
        status: "failed",
        code: "SQL_DRY_PLAN_RELATIONSHIP_MISMATCH",
        message:
          dryPlanSnapshot.reason ??
          "dry-plan relationship consistency check failed"
      };
    }

    return {
      check: "dry-plan",
      status: "passed"
    };
  }

  private resolveDryRunCapability(datasourceType?: DatasourceType): {
    supported: boolean;
    reason?: string;
  } {
    if (!datasourceType) {
      return {
        supported: false,
        reason: "dry-run skipped: datasource type unknown"
      };
    }
    const fromRouter = this.queryExecutorRouter?.getValidationCapabilities(datasourceType);
    if (fromRouter) {
      return {
        supported: fromRouter.dryRun,
        reason: fromRouter.dryRun ? undefined : fromRouter.reason
      };
    }
    if (datasourceType === "csv" || datasourceType === "excel") {
      return {
        supported: false,
        reason: `${datasourceType} datasource does not support dry-run precheck`
      };
    }
    return {
      supported: true
    };
  }

  private resolveDryPlanCapability(datasourceType?: DatasourceType): {
    supported: boolean;
    reason?: string;
  } {
    if (!datasourceType) {
      return {
        supported: false,
        reason: "dry-plan skipped: datasource type unknown"
      };
    }
    const fromRouter = this.queryExecutorRouter?.getValidationCapabilities(datasourceType);
    if (fromRouter) {
      return {
        supported: fromRouter.dryPlan,
        reason: fromRouter.dryPlan ? undefined : fromRouter.reason
      };
    }
    return {
      supported: true
    };
  }

  private async executeSqliteDryRun(input: {
    sql: string;
    datasourceId?: string;
    datasourceType?: DatasourceType;
  }): Promise<SqlValidationCheckV1 | undefined> {
    if (
      input.datasourceType !== "sqlite" ||
      !input.datasourceId ||
      !this.datasourceService ||
      !this.sqliteQuery
    ) {
      return undefined;
    }

    const datasource = await this.datasourceService.getDatasourceById(input.datasourceId);
    if (!datasource || datasource.type !== "sqlite") {
      return undefined;
    }

    const filePath = this.resolveSqliteFilePath(datasource);
    if (!filePath) {
      return undefined;
    }

    try {
      await this.sqliteQuery.dryRun(input.sql, { filePath });
      return undefined;
    } catch (error) {
      const failure = this.asDomainError(error);
      return {
        check: "dry-run",
        status: "failed",
        code: failure?.code ?? "SQL_DRY_RUN_FAILED",
        message:
          failure?.message ??
          (error instanceof Error ? error.message : "SQLite dry-run 校验失败")
      };
    }
  }

  private resolveSqliteFilePath(datasource: {
    id: string;
    config?: Record<string, unknown> | string | null;
  }): string | undefined {
    if (datasource.id === "sqlite_main") {
      return this.sqliteQuery?.dbPath;
    }

    const config =
      datasource.config && typeof datasource.config === "object"
        ? datasource.config
        : undefined;
    const filePath =
      config && typeof config.path === "string" ? config.path.trim() : "";
    return filePath || undefined;
  }

  private asDomainError(error: unknown): DomainError | undefined {
    return error instanceof DomainError ? error : undefined;
  }

  private toSafeAnalysisEvidence(
    analysis: SqlAnalysisResult,
    resolution: SqlCatalogResolutionResult
  ): NonNullable<SqlValidationArtifactV1["sqlAnalysis"]> {
    return {
      version: "sql-analysis.v1",
      status: analysis.status,
      ...(analysis.dialect ? { dialect: analysis.dialect } : {}),
      normalizedSqlDigest: analysis.normalizedSqlDigest,
      statementCount: analysis.statementCount,
      statementTypes: analysis.statementTypes,
      readOnly: analysis.readOnly,
      tables: resolution.status === "resolved" ? resolution.tables : [],
      columns:
        resolution.status === "resolved"
          ? resolution.columns.map((column) => column.qualifiedName)
          : [],
      functions: analysis.functions,
      wildcards: analysis.wildcards,
      parameters: analysis.parameters,
      astNodeCount: analysis.astNodeCount,
      astDepth: analysis.astDepth,
      reasonCodes: analysis.diagnostics.map((diagnostic) => diagnostic.code)
    };
  }

  private toSafeCatalogEvidence(
    resolution: SqlCatalogResolutionResult
  ): NonNullable<SqlValidationArtifactV1["catalogResolution"]> {
    return {
      version: "sql-catalog-resolution.v1",
      status: resolution.status,
      ...(resolution.schemaSnapshotId
        ? { schemaSnapshotId: resolution.schemaSnapshotId }
        : {}),
      ...(resolution.schemaSnapshotDigest
        ? { schemaSnapshotDigest: resolution.schemaSnapshotDigest }
        : {}),
      ...(resolution.allowedSchemaDigest
        ? { allowedSchemaDigest: resolution.allowedSchemaDigest }
        : {}),
      tables: resolution.tables,
      columns: resolution.columns.map((column) => column.qualifiedName),
      reasonCodes: resolution.reasonCodes
    };
  }

  private selectPrimaryFailure(failures: SqlValidationCheckV1[]): SqlValidationCheckV1 {
    const severity = (failure: SqlValidationCheckV1): number => {
      if (failure.check === "read-only") {
        return 100;
      }
      if (failure.check === "structural" && failure.code?.includes("RESOURCE")) {
        return 95;
      }
      if (failure.check === "permission") {
        return 90;
      }
      if (failure.check === "catalog") {
        return 85;
      }
      if (failure.code === "SQL_PLAN_FAIL_CLOSED" || failure.code === "SQL_PLAN_REQUIRES_CLARIFICATION") {
        return 80;
      }
      if (failure.code?.includes("PROVIDER")) {
        return 75;
      }
      if (failure.check === "parse") {
        return 70;
      }
      if (failure.check === "dialect") {
        return 60;
      }
      if (failure.check === "relationship-path" || failure.check === "dry-plan") {
        return 55;
      }
      if (failure.check === "ledger-fulfillment") {
        return failure.code === "SQL_LEDGER_TERMINAL_OBLIGATION_FAILED" ? 85 : 52;
      }
      if (failure.check === "plan-coverage") {
        return 50;
      }
      return 10;
    };

    return [...failures].sort((left, right) => severity(right) - severity(left))[0];
  }

  private isCorrectableFailure(_check: SqlValidationCheckV1["check"], code?: string): boolean {
    if (!code) {
      return false;
    }
    return (
      code === "SQL_CATALOG_REFERENCE_AMBIGUOUS" ||
      code === "SQL_MISSING_COLUMN" ||
      code === "SQL_DIALECT_MISMATCH" ||
      code === "SQL_ANALYSIS_DIALECT_FUNCTION_UNSUPPORTED"
    );
  }

  private toFailureCategory(
    check: SqlValidationCheckV1["check"],
    code?: string
  ): "validation" | "governance" | "unknown" {
    if (check === "permission" || check === "read-only") {
      return "governance";
    }
    if (code?.includes("PROVIDER")) {
      return "unknown";
    }
    return "validation";
  }

  private resolveRouteKind(semanticPlan: SemanticPlanV1 | undefined): RouteKind {
    if (!semanticPlan) {
      return "text_to_sql";
    }
    const routeFilter = (semanticPlan.filters ?? []).find((entry) =>
      entry.startsWith("route_kind:")
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

  private extractTables(sql: string): string[] {
    const matches = [
      ...sql.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)/gi)
    ];
    const tables = matches
      .map((match) => this.normalizeIdentifier(match[1]))
      .filter((value): value is string => Boolean(value));
    return Array.from(new Set(tables));
  }

  private extractTableColumns(sql: string): string[] {
    const matches = [...sql.matchAll(/\b([a-zA-Z_][\w$]*)\.([a-zA-Z_][\w$]*)\b/g)];
    const normalized = matches
      .map((match) => {
        const table = this.normalizeIdentifier(match[1]);
        const column = this.normalizeIdentifier(match[2]);
        if (!table || !column) {
          return undefined;
        }
        return `${table}.${column}`;
      })
      .filter((value): value is string => Boolean(value));
    return Array.from(new Set(normalized));
  }

  private extractSimpleSelectColumns(sql: string): string[] {
    const selectMatch = /\bselect\b([\s\S]*?)\bfrom\b/i.exec(sql);
    if (!selectMatch?.[1]) {
      return [];
    }
    const parsed: string[] = [];
    for (const chunk of selectMatch[1].split(",")) {
      let candidate = chunk.trim();
      if (!candidate || candidate === "*" || candidate.includes(".") || candidate.includes("(")) {
        continue;
      }
      candidate = candidate.replace(/\bas\s+[a-zA-Z_][\w$]*$/i, "").trim();
      candidate = candidate.replace(/^distinct\s+/i, "").trim();
      const match = /^([a-zA-Z_][\w$]*)/.exec(candidate);
      const normalized = this.normalizeIdentifier(match?.[1]);
      if (normalized) {
        parsed.push(normalized);
      }
    }
    return this.unique(parsed);
  }

  private normalizeJoinPath(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
    );
  }

  private normalizeQualifiedIdentifier(value: string | undefined): string | undefined {
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

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
