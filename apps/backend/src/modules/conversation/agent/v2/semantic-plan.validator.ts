import { Injectable } from "@nestjs/common";
import type { SemanticPlanV1 } from "@text2sql/shared-types";

export interface SemanticPlanValidationResult {
  valid: boolean;
  lowConfidence: boolean;
  unsupportedTables: string[];
  unsupportedColumns: string[];
  reasons: string[];
}

interface ValidateSemanticPlanInput {
  plan: SemanticPlanV1;
  minimumConfidence?: number;
}

@Injectable()
export class SemanticPlanValidator {
  validate(input: ValidateSemanticPlanInput): SemanticPlanValidationResult {
    const minimumConfidence =
      typeof input.minimumConfidence === "number" && Number.isFinite(input.minimumConfidence)
        ? input.minimumConfidence
        : 0.55;
    const plan = input.plan;
    const allowedTables = new Set(this.normalizeList(plan.allowedTables ?? []));
    const selectedTables = this.normalizeList(plan.selectedTables);
    const selectedColumns = this.normalizeList(plan.selectedColumns);
    const forbiddenTables = new Set(this.normalizeList(plan.forbiddenTables ?? []));

    const unsupportedTables = selectedTables.filter((table) => {
      if (forbiddenTables.has(table)) {
        return true;
      }
      if (allowedTables.size === 0) {
        return false;
      }
      return !allowedTables.has(table);
    });

    const unsupportedColumns = selectedColumns.filter((column) => {
      if (!column.includes(".")) {
        return false;
      }
      const [table] = column.split(".");
      const normalizedTable = this.normalizeIdentifier(table);
      if (!normalizedTable) {
        return false;
      }
      if (forbiddenTables.has(normalizedTable)) {
        return true;
      }
      if (allowedTables.size === 0) {
        return false;
      }
      return !allowedTables.has(normalizedTable);
    });

    const lowConfidence = plan.confidence < minimumConfidence;
    const reasons: string[] = [];

    if (plan.route === "answer" && selectedTables.length === 0) {
      reasons.push("plan_missing_selected_tables");
    }
    if (unsupportedTables.length > 0) {
      reasons.push("plan_contains_unsupported_tables");
    }
    if (unsupportedColumns.length > 0) {
      reasons.push("plan_contains_unsupported_columns");
    }
    if (lowConfidence) {
      reasons.push("plan_low_confidence");
    }

    return {
      valid: reasons.length === 0,
      lowConfidence,
      unsupportedTables,
      unsupportedColumns,
      reasons
    };
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
