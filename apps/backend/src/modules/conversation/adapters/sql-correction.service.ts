import { Injectable } from "@nestjs/common";
import type {
  SqlValidationArtifactV1,
  SqlValidationCheckV1,
  Text2SqlV2FailureSemantic
} from "@text2sql/shared-types";
import { DomainError } from "../../../common/domain-error";

export interface SqlCorrectionDecision {
  correctable: boolean;
  reason: string;
  maxAttempts: number;
  category: "validation" | "governance" | "safety" | "provider" | "execution" | "unknown";
  source: "validation" | "execution";
  failureCode?: string;
  failedObligationIds?: string[];
}

export interface SqlCorrectionBudget {
  attemptCount: number;
  maxAttempts: number;
  remainingAttempts: number;
  exhausted: boolean;
}

const MECHANICAL_REPAIR_CODES = new Set([
  "SQL_CATALOG_REFERENCE_AMBIGUOUS",
  "SQL_MISSING_COLUMN",
  "SQL_DIALECT_MISMATCH",
  "SQL_ANALYSIS_DIALECT_FUNCTION_UNSUPPORTED"
]);

@Injectable()
export class SqlCorrectionService {
  readonly maxAttempts = 2;

  decide(error: unknown): SqlCorrectionDecision {
    const validationArtifact = this.readValidationArtifact(error);
    if (validationArtifact?.status === "failed" && validationArtifact.failure) {
      return {
        ...this.decideFromValidationFailure(validationArtifact.failure),
        failedObligationIds: validationArtifact.failedObligationIds
      };
    }

    const validationFailure = this.readValidationFailure(error);
    if (validationFailure) {
      return this.decideFromValidationFailure(validationFailure);
    }

    if (error instanceof DomainError) {
      if (
        error.code === "SQL_TERMINAL_VALIDATION_FAILED" ||
        error.code === "TABLE_PERMISSIONS_FORBIDDEN" ||
        error.code === "TABLE_PERMISSIONS_PARSE_REJECTED"
      ) {
        return {
          correctable: false,
          reason: error.message,
          maxAttempts: 0,
          category: "governance",
          source: "validation",
          failureCode: error.code
        };
      }
      if (error.code.includes("PROVIDER") || error.code.includes("DATASOURCE_UNAVAILABLE")) {
        return {
          correctable: false,
          reason: error.message,
          maxAttempts: 0,
          category: "provider",
          source: "execution",
          failureCode: error.code
        };
      }
    }

    const message = error instanceof Error ? error.message : String(error ?? "");
    const normalized = message.trim().toLowerCase();
    return {
      correctable: false,
      reason: normalized || "unknown",
      maxAttempts: 0,
      category: "unknown",
      source: "execution"
    };
  }

  resolveBudget(input: {
    attemptCount: number;
    maxAttempts?: number;
  }): SqlCorrectionBudget {
    const maxAttempts = Math.max(
      0,
      Number.isFinite(input.maxAttempts) ? Number(input.maxAttempts) : this.maxAttempts
    );
    const attemptCount = Math.max(0, Number(input.attemptCount));
    const remainingAttempts = Math.max(0, maxAttempts - attemptCount);
    return {
      attemptCount,
      maxAttempts,
      remainingAttempts,
      exhausted: attemptCount >= maxAttempts
    };
  }

  private decideFromValidationFailure(
    failure: Text2SqlV2FailureSemantic
  ): SqlCorrectionDecision {
    const category = this.mapFailureCategory(failure);
    const failureCode = failure.code;
    const terminal = Boolean(failure.terminal);
    const codeCorrectable = this.isCorrectableValidationCode(failureCode);
    const correctable = !terminal && codeCorrectable;

    return {
      correctable,
      reason: failure.message,
      maxAttempts: correctable ? this.maxAttempts : 0,
      category,
      source: "validation",
      failureCode
    };
  }

  private mapFailureCategory(
    failure: Text2SqlV2FailureSemantic
  ): SqlCorrectionDecision["category"] {
    if (failure.category === "governance") {
      return "governance";
    }
    if (failure.category === "validation") {
      if (failure.code.includes("SAFETY")) {
        return "safety";
      }
      if (failure.code.includes("PROVIDER")) {
        return "provider";
      }
      return "validation";
    }
    if (failure.category === "execution") {
      return "execution";
    }
    return "unknown";
  }

  private isCorrectableValidationCode(code: string): boolean {
    return MECHANICAL_REPAIR_CODES.has(code);
  }

  private readValidationFailure(error: unknown): Text2SqlV2FailureSemantic | undefined {
    if (!(error instanceof DomainError)) {
      return undefined;
    }
    const details = this.asRecord(error.details);
    const validationFailure = this.asRecord(details?.validationFailure);
    if (!validationFailure) {
      return undefined;
    }
    const code = this.readString(validationFailure.code);
    const message = this.readString(validationFailure.message);
    if (!code || !message) {
      return undefined;
    }
    return {
      code,
      message,
      category:
        validationFailure.category === "validation" ||
        validationFailure.category === "governance" ||
        validationFailure.category === "execution"
          ? validationFailure.category
          : "unknown",
      terminal:
        typeof validationFailure.terminal === "boolean"
          ? validationFailure.terminal
          : undefined,
      correctable:
        typeof validationFailure.correctable === "boolean"
          ? validationFailure.correctable
          : undefined
    };
  }

  private readValidationArtifact(error: unknown): SqlValidationArtifactV1 | undefined {
    if (!(error instanceof DomainError)) {
      return undefined;
    }
    const details = this.asRecord(error.details);
    const validationArtifact = this.asRecord(details?.validationArtifact);
    if (!validationArtifact) {
      return undefined;
    }
    const status = this.readString(validationArtifact.status);
    if (status !== "failed") {
      return undefined;
    }
    const checks = this.readValidationChecks(validationArtifact.checks);
    const failure = this.readValidationFailureFromRecord(validationArtifact.failure);
    if (!failure) {
      return undefined;
    }
    return {
      status: "failed",
      checks,
      correctable: Boolean(validationArtifact.correctable),
      failure,
      failedObligationIds: this.readStringArray(validationArtifact.failedObligationIds),
      terminalObligationIds: this.readStringArray(validationArtifact.terminalObligationIds),
      correctableObligationIds: this.readStringArray(validationArtifact.correctableObligationIds)
    };
  }

  private readValidationFailureFromRecord(
    value: unknown
  ): Text2SqlV2FailureSemantic | undefined {
    const record = this.asRecord(value);
    if (!record) {
      return undefined;
    }
    const code = this.readString(record.code);
    const message = this.readString(record.message);
    if (!code || !message) {
      return undefined;
    }
    return {
      code,
      message,
      category:
        record.category === "validation" ||
        record.category === "governance" ||
        record.category === "execution"
          ? record.category
          : "unknown",
      terminal: typeof record.terminal === "boolean" ? record.terminal : undefined,
      correctable:
        typeof record.correctable === "boolean" ? record.correctable : undefined
    };
  }

  private readValidationChecks(value: unknown): SqlValidationCheckV1[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => {
        const check = this.readString(item.check);
        const status = this.readString(item.status);
        if (
          (check !== "parse" &&
            check !== "structural" &&
            check !== "catalog" &&
            check !== "read-only" &&
            check !== "permission" &&
            check !== "plan-coverage" &&
            check !== "relationship-path" &&
            check !== "dialect" &&
            check !== "dry-run" &&
            check !== "dry-plan" &&
            check !== "ledger-fulfillment") ||
          (status !== "passed" && status !== "failed" && status !== "skipped")
        ) {
          return undefined;
        }
        return {
          check,
          status,
          ...(this.readString(item.code) ? { code: this.readString(item.code) } : {}),
          ...(this.readString(item.message)
            ? { message: this.readString(item.message) }
            : {}),
          ...(this.readStringArray(item.obligationIds).length > 0
            ? { obligationIds: this.readStringArray(item.obligationIds) }
            : {}),
          ...(this.readStringArray(item.failedObligationIds).length > 0
            ? { failedObligationIds: this.readStringArray(item.failedObligationIds) }
            : {}),
          ...(this.readStringArray(item.reasonCodes).length > 0
            ? { reasonCodes: this.readStringArray(item.reasonCodes) }
            : {})
        };
      })
      .filter((item): item is SqlValidationCheckV1 => Boolean(item));
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.readString(item))
      .filter((item): item is string => Boolean(item));
  }
}
