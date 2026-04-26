import { Injectable } from "@nestjs/common";
import type { SemanticPlanV1 } from "@text2sql/shared-types";

export interface SemanticPlanValidationResult {
  valid: boolean;
  lowConfidence: boolean;
  unsupportedTables: string[];
  unsupportedColumns: string[];
  reasons: string[];
  routeKind: "text_to_sql" | "metadata" | "general" | "clarify" | "fail_closed";
  evidenceComplete: boolean;
  requiresClarification: boolean;
  terminal: boolean;
}

interface ValidateSemanticPlanInput {
  plan: SemanticPlanV1;
  minimumConfidence?: number;
}

@Injectable()
export class SemanticPlanValidator {
  validate(input: ValidateSemanticPlanInput): SemanticPlanValidationResult {
    const plan = input.plan;
    const routeKind = this.resolveRouteKind(plan);
    const minimumConfidence = this.resolveMinimumConfidence(routeKind, input.minimumConfidence);
    const allowedTables = new Set(this.normalizeList(plan.allowedTables ?? []));
    const selectedTables = this.normalizeList(plan.selectedTables);
    const selectedColumns = this.normalizeList(plan.selectedColumns);
    const forbiddenTables = new Set(this.normalizeList(plan.forbiddenTables ?? []));
    const evidenceRefs = this.normalizeEvidenceRefs(plan.evidenceRefs);

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

    const evidenceComplete =
      evidenceRefs.length > 0 &&
      (selectedTables.length > 0 ||
        selectedColumns.length > 0 ||
        routeKind === "metadata" ||
        routeKind === "general");

    const lowConfidence =
      routeKind === "fail_closed" ? false : plan.confidence < minimumConfidence;
    const reasons: string[] = [];

    if (routeKind === "text_to_sql" && plan.route !== "answer") {
      reasons.push("plan_route_mismatch_text_to_sql");
    }
    if (routeKind === "clarify" && plan.route !== "clarify") {
      reasons.push("plan_route_mismatch_clarify");
    }
    if (routeKind === "fail_closed" && plan.route !== "reject") {
      reasons.push("plan_route_mismatch_fail_closed");
    }
    if (routeKind === "text_to_sql" && selectedTables.length === 0) {
      reasons.push("plan_missing_selected_tables");
    }
    if (routeKind === "text_to_sql" && !evidenceComplete) {
      reasons.push("plan_missing_grounding_evidence");
    }
    if (routeKind === "text_to_sql" && selectedTables.length > 1) {
      const joinPath = this.normalizeJoinPath(plan.joinPath ?? []);
      if (joinPath.length === 0) {
        reasons.push("plan_missing_join_path");
      }
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

    const terminal =
      routeKind === "fail_closed" ||
      unsupportedTables.length > 0 ||
      unsupportedColumns.length > 0;

    return {
      valid: reasons.length === 0,
      lowConfidence,
      unsupportedTables,
      unsupportedColumns,
      reasons,
      routeKind,
      evidenceComplete,
      requiresClarification: routeKind === "clarify",
      terminal
    };
  }

  private resolveMinimumConfidence(
    routeKind: SemanticPlanValidationResult["routeKind"],
    inputMinimumConfidence?: number
  ): number {
    if (typeof inputMinimumConfidence === "number" && Number.isFinite(inputMinimumConfidence)) {
      return inputMinimumConfidence;
    }
    if (routeKind === "metadata" || routeKind === "general") {
      return 0.35;
    }
    return 0.55;
  }

  private resolveRouteKind(
    plan: SemanticPlanV1
  ): SemanticPlanValidationResult["routeKind"] {
    const routeFilter = (plan.filters ?? []).find((entry) =>
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
    if (plan.route === "clarify") {
      return "clarify";
    }
    if (plan.route === "reject") {
      return "fail_closed";
    }
    return "text_to_sql";
  }

  private normalizeEvidenceRefs(values: string[]): string[] {
    return Array.from(
      new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
    );
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
