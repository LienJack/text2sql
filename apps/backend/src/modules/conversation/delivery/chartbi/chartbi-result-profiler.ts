import { Injectable } from "@nestjs/common";

export const CHARTBI_DISPLAY_ALLOWLIST = [
  "table",
  "metric",
  "bar",
  "line",
  "pie"
] as const;

export const CHARTBI_CHART_ALLOWLIST = ["metric", "bar", "line", "pie"] as const;

export type ChartBiDisplayType = (typeof CHARTBI_DISPLAY_ALLOWLIST)[number];
export type ChartBiChartType = (typeof CHARTBI_CHART_ALLOWLIST)[number];

export interface ChartBiFieldMappings {
  x?: string;
  y?: string;
  dimension?: string;
  measure?: string;
  time?: string;
  category?: string;
  value?: string;
}

export interface ChartBiCanonicalSpec {
  type: ChartBiChartType;
  source: "baseline" | "repaired_intent";
  mappings: ChartBiFieldMappings;
  title?: string;
  insights?: string[];
}

export interface ChartBiSummaryBlock {
  text: string;
  highlights?: Array<{
    label: string;
    value: string | number;
  }>;
}

export interface ChartBiResultProfile {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  previewRows: Array<Record<string, unknown>>;
  rowCount: number;
  numericColumns: string[];
  timeColumns: string[];
  dimensionColumns: string[];
  baselineSpec?: ChartBiCanonicalSpec;
  summary: ChartBiSummaryBlock;
}

export interface ChartBiProfileInput {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  previewLimit?: number;
}

@Injectable()
export class ChartBiResultProfiler {
  profile(input: ChartBiProfileInput): ChartBiResultProfile {
    const columns = this.uniqueNonEmpty(input.columns);
    const rows = input.rows.map((row) => ({ ...row }));
    const previewLimit =
      typeof input.previewLimit === "number" && Number.isFinite(input.previewLimit)
        ? Math.max(0, Math.floor(input.previewLimit))
        : 20;
    const previewRows = rows.slice(0, previewLimit);

    const numericColumns = columns.filter((column) =>
      this.isNumericColumn(rows, column)
    );
    const timeColumns = columns.filter((column) => this.isTimeColumn(rows, column));
    const dimensionColumns = columns.filter(
      (column) => !numericColumns.includes(column)
    );

    const baselineSpec = this.createBaselineSpec({
      rows,
      columns,
      numericColumns,
      timeColumns,
      dimensionColumns
    });

    return {
      columns,
      rows,
      previewRows,
      rowCount: rows.length,
      numericColumns,
      timeColumns,
      dimensionColumns,
      baselineSpec,
      summary: this.createSummary({ rows, baselineSpec })
    };
  }

  private createBaselineSpec(input: {
    rows: Array<Record<string, unknown>>;
    columns: string[];
    numericColumns: string[];
    timeColumns: string[];
    dimensionColumns: string[];
  }): ChartBiCanonicalSpec | undefined {
    if (input.rows.length === 0 || input.columns.length === 0) {
      return undefined;
    }

    const measure = input.numericColumns[0];
    if (!measure) {
      return undefined;
    }

    if (input.rows.length === 1) {
      return {
        type: "metric",
        source: "baseline",
        mappings: {
          value: measure,
          measure
        },
        title: `${measure} metric`
      };
    }

    const time = input.timeColumns[0];
    if (time) {
      return {
        type: "line",
        source: "baseline",
        mappings: {
          x: time,
          y: measure,
          time,
          measure
        },
        title: `${measure} over ${time}`
      };
    }

    const dimension = input.dimensionColumns[0];
    if (dimension) {
      const uniqueCategories = this.uniqueNonEmpty(
        input.rows
          .map((row) => this.readString(row[dimension]))
          .filter((value): value is string => Boolean(value))
      );
      const hasNegativeValue = input.rows.some((row) => {
        const value = this.readNumber(row[measure]);
        return typeof value === "number" && value < 0;
      });

      if (uniqueCategories.length > 0 && uniqueCategories.length <= 6 && !hasNegativeValue) {
        return {
          type: "pie",
          source: "baseline",
          mappings: {
            category: dimension,
            value: measure,
            dimension,
            measure
          },
          title: `${measure} share by ${dimension}`
        };
      }

      return {
        type: "bar",
        source: "baseline",
        mappings: {
          x: dimension,
          y: measure,
          dimension,
          measure
        },
        title: `${measure} by ${dimension}`
      };
    }

    if (input.numericColumns.length === 1) {
      return {
        type: "metric",
        source: "baseline",
        mappings: {
          value: measure,
          measure
        },
        title: `${measure} metric`
      };
    }

    return undefined;
  }

  private createSummary(input: {
    rows: Array<Record<string, unknown>>;
    baselineSpec?: ChartBiCanonicalSpec;
  }): ChartBiSummaryBlock {
    const rowCount = input.rows.length;
    if (rowCount === 0) {
      return {
        text: "Query succeeded but returned no rows; falling back to table view.",
        highlights: [
          {
            label: "rowCount",
            value: 0
          }
        ]
      };
    }

    if (!input.baselineSpec) {
      return {
        text: `Query returned ${rowCount} rows; table preview is available.`,
        highlights: [
          {
            label: "rowCount",
            value: rowCount
          }
        ]
      };
    }

    if (input.baselineSpec.type === "metric") {
      const valueField =
        input.baselineSpec.mappings.value ?? input.baselineSpec.mappings.measure;
      const raw = valueField ? input.rows[0]?.[valueField] : undefined;
      return {
        text: valueField
          ? `${valueField}: ${this.formatMetricValue(raw)}`
          : `Query returned ${rowCount} rows.`,
        highlights: [
          {
            label: "rowCount",
            value: rowCount
          }
        ]
      };
    }

    return {
      text: `Query returned ${rowCount} rows; ${input.baselineSpec.type} chart baseline is available.`,
      highlights: [
        {
          label: "rowCount",
          value: rowCount
        }
      ]
    };
  }

  private formatMetricValue(value: unknown): string {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Number.isInteger(value) ? value.toString() : value.toFixed(2);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return "n/a";
  }

  private isNumericColumn(rows: Array<Record<string, unknown>>, column: string): boolean {
    const values = rows.map((row) => row[column]).filter((value) => value != null);
    if (values.length === 0) {
      return false;
    }
    return values.every((value) => this.readNumber(value) !== undefined);
  }

  private isTimeColumn(rows: Array<Record<string, unknown>>, column: string): boolean {
    if (/(^|_)(date|time|day|month|year|at)$/.test(column.toLowerCase())) {
      return true;
    }

    const values = rows.map((row) => row[column]).filter((value) => value != null);
    if (values.length === 0) {
      return false;
    }

    const parseable = values.filter((value) => this.isDateLike(value)).length;
    return parseable / values.length >= 0.6;
  }

  private isDateLike(value: unknown): boolean {
    if (typeof value !== "string") {
      return false;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed);
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

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private uniqueNonEmpty(values: string[]): string[] {
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
}
