import { Injectable } from "@nestjs/common";
import type { ChartBiVisualIntent } from "./chartbi-intent-parser";
import {
  CHARTBI_CHART_ALLOWLIST,
  type ChartBiCanonicalSpec,
  type ChartBiChartType,
  type ChartBiFieldMappings,
  type ChartBiResultProfile
} from "./chartbi-result-profiler";

export interface ChartBiSpecCompileInput {
  profile: ChartBiResultProfile;
  parsedIntent?: ChartBiVisualIntent;
}

export interface ChartBiSpecCompileResult {
  baseline?: ChartBiCanonicalSpec;
  repairedIntent?: ChartBiCanonicalSpec;
}

@Injectable()
export class ChartBiSpecCompiler {
  compile(input: ChartBiSpecCompileInput): ChartBiSpecCompileResult {
    const baseline = input.profile.baselineSpec
      ? this.cloneSpec(input.profile.baselineSpec)
      : undefined;
    const repairedIntent = input.parsedIntent
      ? this.compileRepairedIntent({
          intent: input.parsedIntent,
          profile: input.profile,
          baseline
        })
      : undefined;

    return {
      ...(baseline ? { baseline } : {}),
      ...(repairedIntent ? { repairedIntent } : {})
    };
  }

  private compileRepairedIntent(input: {
    intent: ChartBiVisualIntent;
    profile: ChartBiResultProfile;
    baseline?: ChartBiCanonicalSpec;
  }): ChartBiCanonicalSpec | undefined {
    const type = this.resolveType(input.intent, input.baseline);
    if (!type) {
      return undefined;
    }

    const mappings = this.resolveMappings({
      type,
      intent: input.intent,
      profile: input.profile,
      baseline: input.baseline
    });

    const required = this.requiredKeys(type);
    const hasAllRequired = required.every((key) => Boolean(mappings[key]));
    if (!hasAllRequired) {
      return undefined;
    }

    return {
      type,
      source: "repaired_intent",
      mappings,
      ...(input.intent.title ? { title: input.intent.title } : {}),
      ...(input.intent.insights && input.intent.insights.length > 0
        ? { insights: this.unique(input.intent.insights) }
        : {})
    };
  }

  private resolveType(
    intent: ChartBiVisualIntent,
    baseline?: ChartBiCanonicalSpec
  ): ChartBiChartType | undefined {
    if (
      intent.type &&
      (CHARTBI_CHART_ALLOWLIST as readonly string[]).includes(intent.type)
    ) {
      return intent.type as ChartBiChartType;
    }

    if (baseline) {
      return baseline.type;
    }

    if (intent.mappings.value || intent.mappings.measure) {
      return "metric";
    }

    if ((intent.mappings.category || intent.mappings.dimension) && intent.mappings.value) {
      return "pie";
    }

    if ((intent.mappings.x || intent.mappings.dimension) && intent.mappings.y) {
      return "bar";
    }

    return undefined;
  }

  private resolveMappings(input: {
    type: ChartBiChartType;
    intent: ChartBiVisualIntent;
    profile: ChartBiResultProfile;
    baseline?: ChartBiCanonicalSpec;
  }): ChartBiFieldMappings {
    const columns = input.profile.columns;
    const baselineMappings = input.baseline?.mappings;

    const resolve = (...candidates: Array<string | undefined>): string | undefined => {
      for (const candidate of candidates) {
        if (!candidate) {
          continue;
        }
        const resolved = this.resolveColumn(candidate, columns);
        if (resolved) {
          return resolved;
        }
      }
      return undefined;
    };

    const measureFallback = input.profile.numericColumns[0];
    const dimensionFallback = input.profile.dimensionColumns[0] ?? columns[0];
    const timeFallback = input.profile.timeColumns[0];

    if (input.type === "metric") {
      const value = resolve(
        input.intent.mappings.value,
        input.intent.mappings.measure,
        input.intent.mappings.y,
        baselineMappings?.value,
        baselineMappings?.measure,
        baselineMappings?.y,
        measureFallback
      );
      return {
        value,
        measure: value
      };
    }

    if (input.type === "line") {
      const x = resolve(
        input.intent.mappings.x,
        input.intent.mappings.time,
        input.intent.mappings.dimension,
        baselineMappings?.x,
        baselineMappings?.time,
        baselineMappings?.dimension,
        timeFallback,
        dimensionFallback
      );
      const y = resolve(
        input.intent.mappings.y,
        input.intent.mappings.measure,
        input.intent.mappings.value,
        baselineMappings?.y,
        baselineMappings?.measure,
        baselineMappings?.value,
        measureFallback
      );
      return {
        x,
        y,
        time: x,
        measure: y
      };
    }

    if (input.type === "bar") {
      const x = resolve(
        input.intent.mappings.x,
        input.intent.mappings.dimension,
        input.intent.mappings.category,
        baselineMappings?.x,
        baselineMappings?.dimension,
        baselineMappings?.category,
        dimensionFallback
      );
      const y = resolve(
        input.intent.mappings.y,
        input.intent.mappings.measure,
        input.intent.mappings.value,
        baselineMappings?.y,
        baselineMappings?.measure,
        baselineMappings?.value,
        measureFallback
      );
      return {
        x,
        y,
        dimension: x,
        measure: y
      };
    }

    const category = resolve(
      input.intent.mappings.category,
      input.intent.mappings.dimension,
      input.intent.mappings.x,
      baselineMappings?.category,
      baselineMappings?.dimension,
      baselineMappings?.x,
      dimensionFallback
    );
    const value = resolve(
      input.intent.mappings.value,
      input.intent.mappings.measure,
      input.intent.mappings.y,
      baselineMappings?.value,
      baselineMappings?.measure,
      baselineMappings?.y,
      measureFallback
    );
    return {
      category,
      value,
      dimension: category,
      measure: value
    };
  }

  private requiredKeys(type: ChartBiChartType): Array<keyof ChartBiFieldMappings> {
    if (type === "metric") {
      return ["value"];
    }
    if (type === "pie") {
      return ["category", "value"];
    }
    return ["x", "y"];
  }

  private resolveColumn(candidate: string, columns: string[]): string | undefined {
    const exact = columns.find((column) => column === candidate);
    if (exact) {
      return exact;
    }

    const lowered = candidate.toLowerCase();
    const caseInsensitive = columns.find((column) => column.toLowerCase() === lowered);
    if (caseInsensitive) {
      return caseInsensitive;
    }

    const normalized = this.normalizeKey(candidate);
    const byNormalized = columns.find(
      (column) => this.normalizeKey(column) === normalized
    );
    if (byNormalized) {
      return byNormalized;
    }

    const fuzzy = columns.find((column) =>
      this.normalizeKey(column).includes(normalized)
    );
    return fuzzy;
  }

  private normalizeKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  private cloneSpec(spec: ChartBiCanonicalSpec): ChartBiCanonicalSpec {
    return {
      ...spec,
      mappings: {
        ...spec.mappings
      },
      ...(spec.insights ? { insights: [...spec.insights] } : {})
    };
  }

  private unique(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
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
