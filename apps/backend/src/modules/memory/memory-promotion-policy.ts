import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { SqlRun } from "@text2sql/shared-types";

export type MemoryPromotionStatus = "candidate" | "verified" | "production";

export interface MemoryEvidenceStats {
  sampleCount: number;
  successCount: number;
  riskFlagCount: number;
  successRate: number;
}

export interface MemoryPromotionRecord {
  candidateId: string;
  status: MemoryPromotionStatus;
  evidence: MemoryEvidenceStats;
  version: number;
  lastRunId: string | null;
  lastTransitionKey: string | null;
  updatedAt: string;
}

export interface MemoryPromotionPolicyOptions {
  minSamplesForVerified: number;
  minSuccessesForVerified: number;
  maxRiskFlagsForVerified: number;
  minSamplesForProduction: number;
  minSuccessRateForProduction: number;
  maxRiskFlagsForProduction: number;
}

export interface MemoryPromotionEvaluationInput {
  record: MemoryPromotionRecord;
  run: SqlRun;
  riskTags: string[];
}

export interface MemoryPromotionEvaluationResult {
  nextEvidence: MemoryEvidenceStats;
  rejectionReasons: string[];
  transition?: {
    from: MemoryPromotionStatus;
    to: MemoryPromotionStatus;
    transitionKey: string;
  };
}

const DEFAULT_POLICY_OPTIONS: Readonly<MemoryPromotionPolicyOptions> = {
  minSamplesForVerified: 1,
  minSuccessesForVerified: 1,
  maxRiskFlagsForVerified: 0,
  minSamplesForProduction: 3,
  minSuccessRateForProduction: 0.8,
  maxRiskFlagsForProduction: 0
};

export const MEMORY_PROMOTION_POLICY_OPTIONS = "MEMORY_PROMOTION_POLICY_OPTIONS";

@Injectable()
export class MemoryPromotionPolicy {
  private readonly options: MemoryPromotionPolicyOptions;

  constructor(
    @Optional()
    @Inject(MEMORY_PROMOTION_POLICY_OPTIONS)
    options?: Partial<MemoryPromotionPolicyOptions>
  ) {
    this.options = {
      ...DEFAULT_POLICY_OPTIONS,
      ...options
    };
  }

  createInitialRecord(candidateId: string, at: string): MemoryPromotionRecord {
    return {
      candidateId,
      status: "candidate",
      evidence: {
        sampleCount: 0,
        successCount: 0,
        riskFlagCount: 0,
        successRate: 0
      },
      version: 0,
      lastRunId: null,
      lastTransitionKey: null,
      updatedAt: at
    };
  }

  buildCandidateId(input: {
    datasourceId: string;
    sessionId: string;
    question: string;
    sql?: string;
  }): string {
    const material = [
      input.datasourceId.trim().toLowerCase(),
      input.sessionId.trim().toLowerCase(),
      this.normalizeCandidateContent(input.sql, input.question)
    ].join("::");
    const digest = createHash("sha256").update(material).digest("hex").slice(0, 24);
    return `memory-${digest}`;
  }

  buildTriggerIdempotencyKey(input: {
    candidateId: string;
    runId: string;
  }): string {
    return `${input.candidateId}:trigger:${input.runId.trim()}`;
  }

  buildTransitionKey(input: {
    candidateId: string;
    from: MemoryPromotionStatus;
    to: MemoryPromotionStatus;
  }): string {
    this.assertTransitionAllowed(input.from, input.to);
    return `${input.candidateId}:${input.from}->${input.to}`;
  }

  evaluate(input: MemoryPromotionEvaluationInput): MemoryPromotionEvaluationResult {
    const nextEvidence = this.nextEvidence(input.record.evidence, input.run, input.riskTags);
    const rejectionReasons = this.resolveRejectionReasons(input.record.status, nextEvidence);
    if (input.record.status === "production") {
      return {
        nextEvidence,
        rejectionReasons: ["already_production"]
      };
    }
    if (rejectionReasons.length > 0) {
      return {
        nextEvidence,
        rejectionReasons
      };
    }

    const targetStatus = this.resolveTargetStatus(input.record.status);
    const transitionKey = this.buildTransitionKey({
      candidateId: input.record.candidateId,
      from: input.record.status,
      to: targetStatus
    });
    return {
      nextEvidence,
      rejectionReasons: [],
      transition: {
        from: input.record.status,
        to: targetStatus,
        transitionKey
      }
    };
  }

  private resolveTargetStatus(
    currentStatus: MemoryPromotionStatus
  ): MemoryPromotionStatus {
    if (currentStatus === "candidate") {
      return "verified";
    }
    return "production";
  }

  private resolveRejectionReasons(
    currentStatus: MemoryPromotionStatus,
    evidence: MemoryEvidenceStats
  ): string[] {
    if (currentStatus === "candidate") {
      return this.resolveCandidateRejections(evidence);
    }
    if (currentStatus === "verified") {
      return this.resolveVerifiedRejections(evidence);
    }
    return [];
  }

  private resolveCandidateRejections(evidence: MemoryEvidenceStats): string[] {
    const reasons: string[] = [];
    if (evidence.sampleCount < this.options.minSamplesForVerified) {
      reasons.push("insufficient_samples_for_verified");
    }
    if (evidence.successCount < this.options.minSuccessesForVerified) {
      reasons.push("insufficient_successes_for_verified");
    }
    if (evidence.riskFlagCount > this.options.maxRiskFlagsForVerified) {
      reasons.push("risk_threshold_exceeded_for_verified");
    }
    return reasons;
  }

  private resolveVerifiedRejections(evidence: MemoryEvidenceStats): string[] {
    const reasons: string[] = [];
    if (evidence.sampleCount < this.options.minSamplesForProduction) {
      reasons.push("insufficient_samples_for_production");
    }
    if (evidence.successRate < this.options.minSuccessRateForProduction) {
      reasons.push("insufficient_success_rate_for_production");
    }
    if (evidence.riskFlagCount > this.options.maxRiskFlagsForProduction) {
      reasons.push("risk_threshold_exceeded_for_production");
    }
    return reasons;
  }

  private nextEvidence(
    previous: MemoryEvidenceStats,
    run: SqlRun,
    riskTags: string[]
  ): MemoryEvidenceStats {
    const sampleCount = previous.sampleCount + 1;
    const successCount =
      previous.successCount + (this.isSuccessfulRun(run) ? 1 : 0);
    const riskFlagCount = previous.riskFlagCount + (riskTags.length > 0 ? 1 : 0);
    return {
      sampleCount,
      successCount,
      riskFlagCount,
      successRate: sampleCount === 0 ? 0 : successCount / sampleCount
    };
  }

  private isSuccessfulRun(run: SqlRun): boolean {
    return (
      run.status === "executionResult" &&
      !run.error &&
      Boolean(run.sql?.trim())
    );
  }

  private normalizeCandidateContent(sql: string | undefined, question: string): string {
    const normalizedSql = sql?.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalizedSql) {
      return `sql:${normalizedSql}`;
    }
    return `question:${question.trim().toLowerCase().replace(/\s+/g, " ")}`;
  }

  private assertTransitionAllowed(
    from: MemoryPromotionStatus,
    to: MemoryPromotionStatus
  ): void {
    const allowed: Record<MemoryPromotionStatus, MemoryPromotionStatus[]> = {
      candidate: ["verified"],
      verified: ["production"],
      production: []
    };
    if (!allowed[from].includes(to)) {
      throw new Error(`非法记忆状态迁移: ${from} -> ${to}`);
    }
  }
}
