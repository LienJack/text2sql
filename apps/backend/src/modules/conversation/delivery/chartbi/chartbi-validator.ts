import { Injectable } from "@nestjs/common";
import {
  CHARTBI_CHART_ALLOWLIST,
  type ChartBiCanonicalSpec,
  type ChartBiChartType,
  type ChartBiFieldMappings
} from "./chartbi-result-profiler";

export interface ChartBiValidationInput {
  spec: ChartBiCanonicalSpec;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export interface ChartBiValidationResult {
  ok: boolean;
  reason?: string;
}

@Injectable()
export class ChartBiValidator {
  validate(input: ChartBiValidationInput): ChartBiValidationResult {
    const type = input.spec.type;
    if (!(CHARTBI_CHART_ALLOWLIST as readonly string[]).includes(type)) {
      return this.fail(
        `chart type \"${String(type)}\" is outside allowlist (${CHARTBI_CHART_ALLOWLIST.join(", ")}).`
      );
    }

    if (input.columns.length === 0) {
      return this.fail("result columns are empty; chart validation is fail-closed.");
    }

    if (input.rows.length === 0) {
      return this.fail("result rows are empty; chart validation is fail-closed.");
    }

    const fieldCheck = this.validateFieldOwnership({
      type,
      mappings: input.spec.mappings,
      columns: input.columns
    });
    if (!fieldCheck.ok) {
      return fieldCheck;
    }

    const shapeCheck = this.validateDataShape({
      type,
      mappings: input.spec.mappings,
      rows: input.rows
    });
    if (!shapeCheck.ok) {
      return shapeCheck;
    }

    return { ok: true };
  }

  private validateFieldOwnership(input: {
    type: ChartBiChartType;
    mappings: ChartBiFieldMappings;
    columns: string[];
  }): ChartBiValidationResult {
    const requiredRoles = this.requiredRoles(input.type);
    const caseInsensitiveColumns = new Map(
      input.columns.map((column) => [column.toLowerCase(), column])
    );

    for (const role of requiredRoles) {
      const field = this.readRoleField(input.mappings, role);
      if (!field) {
        return this.fail(`required mapping \"${role}\" is missing.`);
      }
      if (!caseInsensitiveColumns.has(field.toLowerCase())) {
        return this.fail(
          `mapped field \"${field}\" for role \"${role}\" does not exist in result columns.`
        );
      }
    }

    return {
      ok: true
    };
  }

  private validateDataShape(input: {
    type: ChartBiChartType;
    mappings: ChartBiFieldMappings;
    rows: Array<Record<string, unknown>>;
  }): ChartBiValidationResult {
    if (input.type === "metric") {
      const valueField = this.readRoleField(input.mappings, "value");
      if (!valueField) {
        return this.fail("metric chart requires value mapping.");
      }
      const hasNumeric = input.rows.some((row) => this.isNumeric(row[valueField]));
      if (!hasNumeric) {
        return this.fail(
          `metric field \"${valueField}\" has no numeric values in result rows.`
        );
      }
      return { ok: true };
    }

    if (input.type === "pie") {
      const categoryField = this.readRoleField(input.mappings, "category");
      const valueField = this.readRoleField(input.mappings, "value");
      if (!categoryField || !valueField) {
        return this.fail("pie chart requires category and value mappings.");
      }

      const categories = new Set<string>();
      for (const row of input.rows) {
        const categoryValue = row[categoryField];
        if (categoryValue != null) {
          categories.add(String(categoryValue));
        }

        const numeric = this.readNumber(row[valueField]);
        if (numeric === undefined) {
          return this.fail(
            `pie value field \"${valueField}\" contains non-numeric values.`
          );
        }
        if (numeric < 0) {
          return this.fail(
            `pie value field \"${valueField}\" contains negative values.`
          );
        }
      }

      if (categories.size > 12) {
        return this.fail(
          `pie category field \"${categoryField}\" has ${categories.size} categories; exceeds safe limit 12.`
        );
      }

      return { ok: true };
    }

    const xField = this.readRoleField(input.mappings, "x");
    const yField = this.readRoleField(input.mappings, "y");
    if (!xField || !yField) {
      return this.fail(`${input.type} chart requires x/y mappings.`);
    }

    const hasDimensionValue = input.rows.some((row) => this.hasRenderableValue(row[xField]));
    if (!hasDimensionValue) {
      return this.fail(
        `${input.type} x field \"${xField}\" has no renderable values.`
      );
    }

    const hasNumericMeasure = input.rows.some((row) => this.isNumeric(row[yField]));
    if (!hasNumericMeasure) {
      return this.fail(
        `${input.type} y field \"${yField}\" has no numeric values.`
      );
    }

    if (input.type === "line" && !this.isLikelyTemporal(input.rows, xField)) {
      return this.fail(
        `line x field \"${xField}\" is not temporal; use bar/table fallback.`
      );
    }

    return { ok: true };
  }

  private requiredRoles(type: ChartBiChartType): Array<"x" | "y" | "category" | "value"> {
    if (type === "metric") {
      return ["value"];
    }
    if (type === "pie") {
      return ["category", "value"];
    }
    return ["x", "y"];
  }

  private readRoleField(
    mappings: ChartBiFieldMappings,
    role: "x" | "y" | "category" | "value"
  ): string | undefined {
    if (role === "x") {
      return mappings.x ?? mappings.dimension ?? mappings.time ?? mappings.category;
    }
    if (role === "y") {
      return mappings.y ?? mappings.measure ?? mappings.value;
    }
    if (role === "category") {
      return mappings.category ?? mappings.dimension ?? mappings.x;
    }
    return mappings.value ?? mappings.measure ?? mappings.y;
  }

  private isLikelyTemporal(rows: Array<Record<string, unknown>>, field: string): boolean {
    if (/(^|_)(date|time|day|month|year|at)$/.test(field.toLowerCase())) {
      return true;
    }

    const values = rows.map((row) => row[field]).filter((value) => value != null);
    if (values.length === 0) {
      return false;
    }
    const parseable = values.filter((value) => {
      if (typeof value !== "string") {
        return false;
      }
      return Number.isFinite(Date.parse(value));
    }).length;
    return parseable / values.length >= 0.6;
  }

  private isNumeric(value: unknown): boolean {
    return this.readNumber(value) !== undefined;
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private hasRenderableValue(value: unknown): boolean {
    if (value == null) {
      return false;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return true;
  }

  private fail(reason: string): ChartBiValidationResult {
    return {
      ok: false,
      reason
    };
  }
}
