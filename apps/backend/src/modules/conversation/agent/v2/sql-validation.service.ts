import { Injectable } from "@nestjs/common";
import type {
  DatasourceType,
  SemanticPlanV1,
  SqlValidationArtifactV1,
  SqlValidationCheckV1
} from "@text2sql/shared-types";

interface ValidateSqlInput {
  sql: string;
  datasourceType?: DatasourceType;
  semanticPlan?: SemanticPlanV1;
}

@Injectable()
export class SqlValidationService {
  validate(input: ValidateSqlInput): SqlValidationArtifactV1 {
    const checks: SqlValidationCheckV1[] = [];
    const sql = input.sql.trim();

    const readOnlyStatus = this.validateReadOnly(sql);
    checks.push(readOnlyStatus);

    const parseStatus = this.validateParse(sql);
    checks.push(parseStatus);

    const permissionStatus = this.validateTablePermission(sql, input.semanticPlan);
    checks.push(permissionStatus);

    const planCoverage = this.validatePlanCoverage(sql, input.semanticPlan);
    checks.push(planCoverage);

    checks.push(this.validateRelationshipPath(sql, input.semanticPlan));
    checks.push(this.validateDialect(sql, input.datasourceType));
    checks.push({ check: "dry-run", status: "skipped", message: "dry-run not configured" });
    checks.push({ check: "dry-plan", status: "skipped", message: "dry-plan not configured" });

    const failure = checks.find((check) => check.status === "failed");
    if (!failure) {
      return {
        status: "passed",
        checks,
        correctable: false
      };
    }

    const correctable = this.isCorrectableFailure(failure.check, failure.code);
    return {
      status: "failed",
      checks,
      correctable,
      failure: {
        code: failure.code ?? "SQL_VALIDATION_FAILED",
        message: failure.message ?? "SQL validation failed",
        category: this.toFailureCategory(failure.check),
        terminal: !correctable,
        correctable
      }
    };
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
    const normalized = sql.toLowerCase();
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
    if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i.test(sql)) {
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

  private validateTablePermission(
    sql: string,
    semanticPlan?: SemanticPlanV1
  ): SqlValidationCheckV1 {
    const allowedTables = new Set(this.normalizeList(semanticPlan?.allowedTables ?? []));
    if (allowedTables.size === 0) {
      return {
        check: "permission",
        status: "skipped",
        message: "permission check skipped: allowed tables not configured"
      };
    }
    const tables = this.extractTables(sql);
    const denied = tables.filter((table) => !allowedTables.has(table));
    if (denied.length > 0) {
      return {
        check: "permission",
        status: "failed",
        code: "SQL_TABLE_PERMISSION_DENIED",
        message: `未授权表: ${denied.join(", ")}`
      };
    }
    return {
      check: "permission",
      status: "passed"
    };
  }

  private validatePlanCoverage(sql: string, semanticPlan?: SemanticPlanV1): SqlValidationCheckV1 {
    if (!semanticPlan) {
      return {
        check: "plan-coverage",
        status: "skipped",
        message: "plan coverage skipped: semantic plan missing"
      };
    }
    const selectedTables = new Set(this.normalizeList(semanticPlan.selectedTables));
    if (selectedTables.size === 0) {
      return {
        check: "plan-coverage",
        status: "skipped",
        message: "plan coverage skipped: semantic plan has no selected tables"
      };
    }
    const tables = this.extractTables(sql);
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
    const hasJoinPath = (semanticPlan?.joinPath?.length ?? 0) > 0;
    const sqlUsesJoin = /\bjoin\b/i.test(sql);
    if (!hasJoinPath || !sqlUsesJoin) {
      return {
        check: "relationship-path",
        status: "skipped"
      };
    }
    return {
      check: "relationship-path",
      status: "passed"
    };
  }

  private validateDialect(sql: string, datasourceType?: DatasourceType): SqlValidationCheckV1 {
    if (!datasourceType || datasourceType === "sqlite") {
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
    return {
      check: "dialect",
      status: "passed"
    };
  }

  private isCorrectableFailure(check: SqlValidationCheckV1["check"], code?: string): boolean {
    if (check === "parse" || check === "relationship-path" || check === "dialect") {
      return true;
    }
    if (code === "SQL_MISSING_COLUMN") {
      return true;
    }
    return false;
  }

  private toFailureCategory(
    check: SqlValidationCheckV1["check"]
  ): "validation" | "governance" {
    if (check === "permission" || check === "read-only") {
      return "governance";
    }
    return "validation";
  }

  private extractTables(sql: string): string[] {
    const matches = [...sql.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)?)/gi)];
    const tables = matches
      .map((match) => this.normalizeIdentifier(match[1]))
      .filter((value): value is string => Boolean(value));
    return Array.from(new Set(tables));
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
