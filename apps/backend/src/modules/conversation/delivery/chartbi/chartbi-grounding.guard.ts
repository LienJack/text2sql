import { Injectable } from "@nestjs/common";
import type { ChartBiCanonicalSpec } from "./chartbi-result-profiler";

export interface ChartBiGroundingInput {
  spec: ChartBiCanonicalSpec;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export interface ChartBiGroundingResult {
  ok: boolean;
  insights: string[];
  reason?: string;
}

@Injectable()
export class ChartBiGroundingGuard {
  enforce(input: ChartBiGroundingInput): ChartBiGroundingResult {
    const insights = input.spec.insights ?? [];
    if (insights.length === 0) {
      return {
        ok: true,
        insights: []
      };
    }

    const numericEvidence = this.collectNumericEvidence(input.rows);
    const knownColumns = new Set(input.columns.map((column) => column.toLowerCase()));

    const grounded: string[] = [];
    let dropped = 0;

    for (const insight of insights) {
      const referencesKnownColumns = this.referencesKnownColumns(insight, knownColumns);
      const referencesKnownNumbers = this.referencesKnownNumbers(insight, numericEvidence);

      if (referencesKnownColumns && referencesKnownNumbers) {
        grounded.push(insight);
        continue;
      }

      dropped += 1;
    }

    return {
      ok: true,
      insights: grounded,
      ...(dropped > 0
        ? {
            reason:
              "Removed ungrounded model insights that referenced unknown fields or numbers."
          }
        : {})
    };
  }

  private referencesKnownColumns(
    insight: string,
    knownColumns: Set<string>
  ): boolean {
    const fieldRefs = [...insight.matchAll(/`([^`]+)`/g)]
      .map((match) => match[1]?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));

    if (fieldRefs.length === 0) {
      return true;
    }

    return fieldRefs.every((field) => knownColumns.has(field));
  }

  private referencesKnownNumbers(insight: string, evidence: Set<number>): boolean {
    const numbers = [...insight.matchAll(/-?\d+(?:\.\d+)?/g)]
      .map((match) => Number(match[0]))
      .filter((value) => Number.isFinite(value));

    if (numbers.length === 0) {
      return true;
    }

    return numbers.every((value) => evidence.has(value));
  }

  private collectNumericEvidence(rows: Array<Record<string, unknown>>): Set<number> {
    const evidence = new Set<number>();
    for (const row of rows) {
      for (const value of Object.values(row)) {
        const numeric = this.readNumber(value);
        if (numeric !== undefined) {
          evidence.add(numeric);
        }
      }
    }
    return evidence;
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
}
