import { Injectable } from "@nestjs/common";
import type {
  SemanticContextPackV1,
  SemanticPlanV1,
  SqlValidationArtifactV1,
  Text2SqlV2FailureSemantic
} from "@text2sql/shared-types";
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
}
