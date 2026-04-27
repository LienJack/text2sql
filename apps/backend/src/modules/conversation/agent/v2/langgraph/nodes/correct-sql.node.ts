import { Injectable } from "@nestjs/common";
import type {
  SqlCorrectionGroundingV1,
  SemanticContextPackV1,
  SemanticPlanV1,
  SqlValidationArtifactV1,
  Text2SqlV2FailureSemantic
} from "@text2sql/shared-types";
import { createHash } from "node:crypto";
import { DomainError } from "../../../../../../common/domain-error";
import {
  SqlCorrectionService,
  type SqlCorrectionBudget,
  type SqlCorrectionDecision
} from "../../sql-correction.service";

export interface SqlCorrectionArtifact {
  failedSql: string;
  retryReason: string;
  category: SqlCorrectionDecision["category"];
  source: SqlCorrectionDecision["source"];
  failureCode?: string;
  attemptCount: number;
  maxAttempts: number;
  semanticPlanSnapshotId?: string;
  evidenceRefs: string[];
  grounding: SqlCorrectionGroundingV1;
  shouldRevalidate: boolean;
}

export interface CorrectSqlNodeResult {
  outcome: "retry_generation" | "terminal";
  budget: SqlCorrectionBudget;
  artifact: SqlCorrectionArtifact;
  failure?: Text2SqlV2FailureSemantic;
}

@Injectable()
export class CorrectSqlNode {
  constructor(private readonly sqlCorrectionService: SqlCorrectionService) {}

  run(input: {
    failedSql: string;
    validationArtifact?: SqlValidationArtifactV1;
    error?: unknown;
    attemptCount: number;
    maxAttempts?: number;
    semanticPlan?: SemanticPlanV1;
    contextPack?: SemanticContextPackV1;
  }): CorrectSqlNodeResult {
    const decision = this.sqlCorrectionService.decide(
      input.error ?? this.toValidationError(input.validationArtifact)
    );
    const nextAttemptCount = input.attemptCount + 1;
    const budget = this.sqlCorrectionService.resolveBudget({
      attemptCount: nextAttemptCount,
      maxAttempts: input.maxAttempts ?? decision.maxAttempts
    });
    const evidenceRefs = this.unique([
      ...(input.semanticPlan?.evidenceRefs ?? []),
      ...(input.contextPack?.selectedEvidenceIds ?? [])
    ]);

    const artifact: SqlCorrectionArtifact = {
      failedSql: input.failedSql,
      retryReason: decision.reason,
      category: decision.category,
      source: decision.source,
      failureCode: decision.failureCode,
      attemptCount: nextAttemptCount,
      maxAttempts: budget.maxAttempts,
      semanticPlanSnapshotId: input.semanticPlan?.snapshotId,
      evidenceRefs,
      grounding: this.buildCorrectionGrounding({
        failedSql: input.failedSql,
        retryReason: decision.reason,
        category: decision.category,
        source: decision.source,
        failureCode: decision.failureCode,
        attemptCount: nextAttemptCount,
        maxAttempts: budget.maxAttempts,
        evidenceRefs,
        semanticPlan: input.semanticPlan,
        contextPack: input.contextPack
      }),
      shouldRevalidate: decision.correctable && !budget.exhausted
    };

    if (!decision.correctable || budget.exhausted) {
      const exhausted = budget.exhausted && decision.correctable;
      return {
        outcome: "terminal",
        budget,
        artifact,
        failure: {
          code: exhausted
            ? "SQL_CORRECTION_BUDGET_EXHAUSTED"
            : decision.failureCode ?? "SQL_CORRECTION_NOT_ALLOWED",
          message: exhausted
            ? `SQL correction budget exhausted after ${budget.maxAttempts} attempts`
            : decision.reason,
          category:
            decision.category === "governance"
              ? "governance"
              : decision.category === "safety"
                ? "governance"
                : decision.category === "provider"
                  ? "execution"
              : decision.category === "execution"
                ? "execution"
                : "validation",
          terminal: true,
          correctable: false
        }
      };
    }

    return {
      outcome: "retry_generation",
      budget,
      artifact
    };
  }

  private toValidationError(
    validationArtifact?: SqlValidationArtifactV1
  ): DomainError | Error {
    if (!validationArtifact?.failure) {
      return new Error("unknown validation failure");
    }
    return new DomainError(
      "SQL_VALIDATION_FAILED",
      validationArtifact.failure.message,
      422,
      {
        validationArtifact
      }
    );
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }

  private buildCorrectionGrounding(input: {
    failedSql: string;
    retryReason: string;
    category: SqlCorrectionDecision["category"];
    source: SqlCorrectionDecision["source"];
    failureCode?: string;
    attemptCount: number;
    maxAttempts: number;
    evidenceRefs: string[];
    semanticPlan?: SemanticPlanV1;
    contextPack?: SemanticContextPackV1;
  }): SqlCorrectionGroundingV1 {
    return {
      failedSqlRef: this.buildSqlRef(input.failedSql),
      failedSqlPreview: this.buildSqlPreview(input.failedSql),
      retryReason: input.retryReason,
      failureCode: input.failureCode,
      failureCategory: input.category,
      source: input.source,
      attemptCount: input.attemptCount,
      maxAttempts: input.maxAttempts,
      evidenceRefs: input.evidenceRefs,
      semanticPlanSnapshotId: input.semanticPlan?.snapshotId,
      semanticPlanRoute: input.semanticPlan?.route,
      semanticPlanRouteKind: this.resolveRouteKind(input.semanticPlan),
      selectedTableCount: input.semanticPlan?.selectedTables.length,
      selectedColumnCount: input.semanticPlan?.selectedColumns.length,
      contextPackStatus: input.contextPack?.status,
      contextPackEvidenceCount:
        input.contextPack?.selectedContextSummary?.count ??
        input.contextPack?.selectedEvidenceIds.length
    };
  }

  private buildSqlRef(sql: string): string {
    const digest = createHash("sha256")
      .update(sql)
      .digest("hex")
      .slice(0, 16);
    return `sql.sha256.${digest}`;
  }

  private buildSqlPreview(sql: string): string {
    const compact = sql.replace(/\s+/g, " ").trim();
    if (compact.length <= 180) {
      return compact;
    }
    return `${compact.slice(0, 180)}...`;
  }

  private resolveRouteKind(
    semanticPlan?: SemanticPlanV1
  ): "text_to_sql" | "metadata" | "general" | "clarify" | "fail_closed" | undefined {
    if (!semanticPlan) {
      return undefined;
    }
    const routeFilter = semanticPlan.filters?.find((item) =>
      item.startsWith("route_kind:")
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
}
