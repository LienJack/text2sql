import { Injectable } from "@nestjs/common";
import type {
  SemanticPlanCoverageGapV1,
  SemanticPlanV1
} from "@text2sql/shared-types";

export interface SemanticPlanValidationResult {
  valid: boolean;
  lowConfidence: boolean;
  unsupportedTables: string[];
  unsupportedColumns: string[];
  reasons: string[];
  ledgerGateOutcome: "pass" | "warning" | "block";
  blockedObligationIds: string[];
  warningObligationIds: string[];
  routeKind: "text_to_sql" | "metadata" | "general" | "clarify" | "fail_closed";
  outcome: "ready" | "needs_clarification" | "direct_answer" | "fail_closed";
  evidenceComplete: boolean;
  requiresClarification: boolean;
  shouldDirectAnswer: boolean;
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
    const coverageGaps = this.readCoverageGaps(plan.coverageGaps);
    const invalidCoverageGapCount = this.countInvalidCoverageGaps(plan.coverageGaps);
    const snapshotId = this.readOptionalText((plan as { snapshotId?: unknown }).snapshotId);
    const ledgerSummary = plan.planLedger?.summary;
    const blockedObligationIds = this.normalizeEvidenceRefs(
      ledgerSummary?.failedHardBlockerIds ?? []
    );
    const warningObligationIds = this.normalizeEvidenceRefs(ledgerSummary?.warningIds ?? []);
    const ledgerGateOutcome =
      blockedObligationIds.length > 0
        ? "block"
        : warningObligationIds.length > 0
          ? "warning"
          : "pass";

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
    if (invalidCoverageGapCount > 0) {
      reasons.push("plan_invalid_coverage_gap_shape");
    }
    if ((routeKind === "clarify" || routeKind === "fail_closed" || !evidenceComplete) && coverageGaps.length === 0) {
      reasons.push("plan_missing_coverage_gaps");
    }
    if ("snapshotId" in plan && snapshotId === undefined) {
      reasons.push("plan_invalid_snapshot_id");
    }
    if (ledgerGateOutcome === "block") {
      reasons.push("plan_ledger_gate_blocked");
    }

    const terminalLedgerBlock = (plan.planLedger?.obligations ?? []).some(
      (obligation) =>
        blockedObligationIds.includes(obligation.id) &&
        (obligation.kind === "forbidden_table" ||
          obligation.kind === "permission" ||
          obligation.reasonCodes.some((reasonCode) =>
            /forbidden|permission|policy|unsupported/i.test(reasonCode)
          ))
    );
    const terminal =
      routeKind === "fail_closed" ||
      unsupportedTables.length > 0 ||
      unsupportedColumns.length > 0 ||
      terminalLedgerBlock;
    const shouldDirectAnswer = routeKind === "metadata" || routeKind === "general";
    const outcome = terminal
      ? "fail_closed"
      : shouldDirectAnswer
        ? "direct_answer"
        : routeKind === "clarify"
          ? "needs_clarification"
          : ledgerGateOutcome === "block"
            ? "needs_clarification"
          : "ready";

    return {
      valid: reasons.length === 0,
      lowConfidence,
      unsupportedTables,
      unsupportedColumns,
      reasons,
      ledgerGateOutcome,
      blockedObligationIds,
      warningObligationIds,
      routeKind,
      outcome,
      evidenceComplete,
      requiresClarification: routeKind === "clarify" || outcome === "needs_clarification",
      shouldDirectAnswer,
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

  private readCoverageGaps(value: unknown): SemanticPlanCoverageGapV1[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is SemanticPlanCoverageGapV1 =>
      this.isValidCoverageGap(item)
    );
  }

  private countInvalidCoverageGaps(value: unknown): number {
    if (!Array.isArray(value)) {
      return 0;
    }
    return value.filter((item) => !this.isValidCoverageGap(item)).length;
  }

  private isValidCoverageGap(value: unknown): value is SemanticPlanCoverageGapV1 {
    if (!this.isRecord(value)) {
      return false;
    }
    const gapType = this.readOptionalText(value.gapType);
    const subjectKind = this.readOptionalText(value.subjectKind);
    const reasonCode = this.readOptionalText(value.reasonCode);
    const impactScope = this.readOptionalText(value.impactScope);
    const evidenceRefs = value.evidenceRefs;
    return (
      Boolean(gapType) &&
      Boolean(subjectKind) &&
      Boolean(reasonCode) &&
      Boolean(impactScope) &&
      Array.isArray(evidenceRefs) &&
      evidenceRefs.every((item) => typeof item === "string")
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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private readOptionalText(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
}
