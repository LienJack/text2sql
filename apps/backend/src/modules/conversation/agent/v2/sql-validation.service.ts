import { Injectable, Optional } from "@nestjs/common";
import type {
  DatasourceType,
  SemanticPlanV1,
  SqlValidationArtifactV1,
  SqlValidationCheckV1
} from "@text2sql/shared-types";
import { QueryExecutorRouterService, type SqlTableAccessContext } from "../../../platform/data/query";
import { RelationshipDryRunService } from "../../../platform/data/query/relationship-dry-run.service";

interface ValidateSqlInput {
  sql: string;
  datasourceId?: string;
  datasourceType?: DatasourceType;
  semanticPlan?: SemanticPlanV1;
  accessContext?: SqlTableAccessContext;
  allowedTables?: string[];
}

type RouteKind = "text_to_sql" | "metadata" | "general" | "clarify" | "fail_closed";
export type SqlValidationOutcome = "pass" | "correctable" | "terminal";

@Injectable()
export class SqlValidationService {
  constructor(
    @Optional()
    private readonly queryExecutorRouter?: QueryExecutorRouterService,
    @Optional()
    private readonly relationshipDryRunService?: RelationshipDryRunService
  ) {}

  async validate(input: ValidateSqlInput): Promise<SqlValidationArtifactV1> {
    const checks: SqlValidationCheckV1[] = [];
    const sql = input.sql.trim();
    const routeKind = this.resolveRouteKind(input.semanticPlan);

    const readOnlyStatus = this.validateReadOnly(sql);
    checks.push(readOnlyStatus);

    const parseStatus = this.validateParse(sql);
    checks.push(parseStatus);

    const permissionStatus = this.validatePermission({
      sql,
      semanticPlan: input.semanticPlan,
      accessContext: input.accessContext,
      allowedTables: input.allowedTables
    });
    checks.push(permissionStatus);

    const planCoverage = this.validatePlanCoverage({
      sql,
      semanticPlan: input.semanticPlan,
      routeKind
    });
    checks.push(planCoverage);

    checks.push(this.validateRelationshipPath(sql, input.semanticPlan));
    checks.push(this.validateDialect(sql, input.datasourceType));
    checks.push(
      this.validateDryRun({
        sql,
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
        correctable: false
      };
    }

    const failure = this.selectPrimaryFailure(failedChecks);
    const correctable = this.isCorrectableFailure(failure.check, failure.code);
    return {
      status: "failed",
      checks,
      correctable,
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

  private validateParse(sql: string): SqlValidationCheckV1 {
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
    return {
      check: "parse",
      status: "passed"
    };
  }

  private validateReadOnly(sql: string): SqlValidationCheckV1 {
    if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|replace|merge)\b/i.test(sql)) {
      return {
        check: "read-only",
        status: "failed",
        code: "SQL_READ_ONLY_VIOLATION",
        message: "检测到写操作或 DDL，已阻止执行"
      };
    }
    return {
      check: "read-only",
      status: "passed"
    };
  }

  private validatePermission(input: {
    sql: string;
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

    const tables = this.extractTables(input.sql);
    const denied = tables.filter((table) => forbiddenTables.has(table));
    if (denied.length > 0) {
      return {
        check: "permission",
        status: "failed",
        code: "SQL_TABLE_PERMISSION_DENIED",
        message: `命中语义计划禁用表: ${denied.join(", ")}`
      };
    }

    if (allowedTables.size > 0) {
      const outsideAllowed = tables.filter((table) => !allowedTables.has(table));
      if (outsideAllowed.length > 0) {
        return {
          check: "permission",
          status: "failed",
          code: "SQL_TABLE_PERMISSION_DENIED",
          message: `未授权表: ${outsideAllowed.join(", ")}`
        };
      }
    }

    const selectedColumns = new Set(
      this.normalizeList(input.semanticPlan?.selectedColumns ?? []).filter((column) =>
        column.includes(".")
      )
    );
    if (selectedColumns.size > 0) {
      const referenced = this.extractTableColumns(input.sql);
      const outsideColumns = referenced.filter((column) => !selectedColumns.has(column));
      if (outsideColumns.length > 0) {
        return {
          check: "permission",
          status: "failed",
          code: "SQL_COLUMN_PERMISSION_DENIED",
          message: `命中语义计划外字段: ${outsideColumns.join(", ")}`
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
    sql: string;
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

    const tables = this.extractTables(input.sql);
    const outsidePlan = tables.filter((table) => !selectedTables.has(table));
    if (outsidePlan.length > 0) {
      return {
        check: "plan-coverage",
        status: "failed",
        code: "SQL_PLAN_COVERAGE_OUTSIDE_SELECTED_TABLES",
        message: `SQL 使用了计划外表: ${outsidePlan.join(", ")}`
      };
    }

    return {
      check: "plan-coverage",
      status: "passed"
    };
  }

  private validateRelationshipPath(sql: string, semanticPlan?: SemanticPlanV1): SqlValidationCheckV1 {
    const joinPath = this.normalizeJoinPath(semanticPlan?.joinPath ?? []);
    const selectedTables = this.normalizeList(semanticPlan?.selectedTables ?? []);
    if (joinPath.length === 0 && selectedTables.length <= 1) {
      return {
        check: "relationship-path",
        status: "skipped"
      };
    }

    const sqlUsesJoin = /\bjoin\b/i.test(sql);
    if (!sqlUsesJoin && selectedTables.length > 1) {
      return {
        check: "relationship-path",
        status: "failed",
        code: "SQL_RELATIONSHIP_PATH_MISSING_JOIN",
        message: "语义计划包含多表绑定，但 SQL 未使用 JOIN"
      };
    }

    const referencedTables = this.extractTables(sql);
    const missingTables = selectedTables.filter((table) => !referencedTables.includes(table));
    if (missingTables.length > 0) {
      return {
        check: "relationship-path",
        status: "failed",
        code: "SQL_RELATIONSHIP_PATH_MISMATCH",
        message: `SQL 缺少语义计划关联表: ${missingTables.join(", ")}`
      };
    }

    return {
      check: "relationship-path",
      status: "passed"
    };
  }

  private validateDialect(sql: string, datasourceType?: DatasourceType): SqlValidationCheckV1 {
    if (!datasourceType || datasourceType === "sqlite") {
      if (/\bshow\s+tables\b/i.test(sql)) {
        return {
          check: "dialect",
          status: "failed",
          code: "SQL_DIALECT_MISMATCH",
          message: "SQLite 不支持 SHOW TABLES 语法"
        };
      }
      return {
        check: "dialect",
        status: "passed"
      };
    }
    if (datasourceType === "mysql" && /\bpragma\b/i.test(sql)) {
      return {
        check: "dialect",
        status: "failed",
        code: "SQL_DIALECT_MISMATCH",
        message: "MySQL 不支持 PRAGMA 语法"
      };
    }
    if (datasourceType === "postgresql" && /\bstrftime\s*\(/i.test(sql)) {
      return {
        check: "dialect",
        status: "failed",
        code: "SQL_DIALECT_MISMATCH",
        message: "PostgreSQL 不支持 strftime 函数"
      };
    }
    return {
      check: "dialect",
      status: "passed"
    };
  }

  private validateDryRun(input: {
    sql: string;
    datasourceType?: DatasourceType;
    parseStatus: SqlValidationCheckV1;
    readOnlyStatus: SqlValidationCheckV1;
  }): SqlValidationCheckV1 {
    if (input.parseStatus.status === "failed" || input.readOnlyStatus.status === "failed") {
      return {
        check: "dry-run",
        status: "skipped",
        message: "dry-run skipped because parse/read-only check already failed"
      };
    }

    const capability = this.resolveDryRunCapability(input.datasourceType);
    if (!capability.supported) {
      return {
        check: "dry-run",
        status: "skipped",
        code: "SQL_DRY_RUN_UNSUPPORTED",
        message: capability.reason
      };
    }

    const dryPlan = this.queryExecutorRouter?.buildDryPlan(input.sql);
    if (dryPlan && !dryPlan.complete) {
      return {
        check: "dry-run",
        status: "failed",
        code: "SQL_DRY_RUN_PARSE_REJECTED",
        message: dryPlan.reason ?? "dry-run parse rejected"
      };
    }

    return {
      check: "dry-run",
      status: "passed"
    };
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

  private selectPrimaryFailure(failures: SqlValidationCheckV1[]): SqlValidationCheckV1 {
    const severity = (failure: SqlValidationCheckV1): number => {
      if (failure.check === "read-only") {
        return 100;
      }
      if (failure.check === "permission") {
        return 90;
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
      if (failure.check === "plan-coverage") {
        return 50;
      }
      return 10;
    };

    return [...failures].sort((left, right) => severity(right) - severity(left))[0];
  }

  private isCorrectableFailure(check: SqlValidationCheckV1["check"], code?: string): boolean {
    if (check === "read-only" || check === "permission") {
      return false;
    }
    if (code === "SQL_PLAN_FAIL_CLOSED" || code === "SQL_PLAN_REQUIRES_CLARIFICATION") {
      return false;
    }
    if (code?.includes("PROVIDER") || code === "SQL_DRY_RUN_UNSUPPORTED") {
      return false;
    }
    if (code === "SQL_DRY_PLAN_UNSUPPORTED") {
      return false;
    }
    if (check === "parse" || check === "relationship-path" || check === "dialect") {
      return true;
    }
    if (check === "plan-coverage" || check === "dry-run" || check === "dry-plan") {
      return true;
    }
    if (code === "SQL_MISSING_COLUMN") {
      return true;
    }
    return false;
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

  private normalizeJoinPath(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
    );
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
