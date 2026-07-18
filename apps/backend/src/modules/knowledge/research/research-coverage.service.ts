import { Injectable } from "@nestjs/common";
import type {
  ResearchBrief,
  ResearchCoverageObligation,
  ResearchCoverageResult,
  ResearchSourceSnapshotRecord
} from "./contracts/research.types";

@Injectable()
export class ResearchCoverageService {
  evaluate(input: {
    brief: ResearchBrief;
    snapshots: ResearchSourceSnapshotRecord[];
    rejectionReasonCodes?: string[];
    providerUnavailable?: boolean;
    budgetExhausted?: boolean;
    conflictCount?: number;
  }): ResearchCoverageResult {
    const sourceRefs = input.snapshots.map((snapshot) => snapshot.id);
    const domains = new Set(
      input.snapshots.map((snapshot) => new URL(snapshot.canonicalUrl).hostname)
    );
    const obligations: ResearchCoverageObligation[] = [
      {
        id: "source_count",
        status:
          input.snapshots.length >= input.brief.minIndependentSources
            ? "passed"
            : "failed",
        reasonCodes:
          input.snapshots.length >= input.brief.minIndependentSources
            ? ["minimum_source_count_met"]
            : ["minimum_source_count_not_met"],
        sourceRefs
      },
      {
        id: "independence",
        status:
          domains.size >= input.brief.minIndependentSources ? "passed" : "failed",
        reasonCodes:
          domains.size >= input.brief.minIndependentSources
            ? ["independent_domain_count_met"]
            : ["independent_domain_count_not_met"],
        sourceRefs
      },
      this.timeCoverage(input.brief, input.snapshots),
      this.counterEvidence(input.brief, input.snapshots)
    ];
    const passed = obligations.every((obligation) => obligation.status === "passed");
    const status: ResearchCoverageResult["status"] =
      input.snapshots.length === 0
        ? "insufficient"
        : passed && (input.conflictCount ?? 0) > 0
          ? "conflicted"
          : passed
            ? "complete"
            : "partial";
    return {
      version: "research-coverage.v1",
      status,
      obligations,
      sourceRefs,
      rejectionReasonCodes: [...new Set(input.rejectionReasonCodes ?? [])].sort(),
      stopReason: input.providerUnavailable
        ? "provider_unavailable"
        : passed
          ? "coverage_closed"
          : input.budgetExhausted
            ? "budget_exhausted"
            : "source_exhausted"
    };
  }

  private timeCoverage(
    brief: ResearchBrief,
    snapshots: ResearchSourceSnapshotRecord[]
  ): ResearchCoverageObligation {
    if (!brief.timeBoundary?.from && !brief.timeBoundary?.to) {
      return {
        id: "time_coverage",
        status: "passed",
        reasonCodes: ["time_boundary_not_required"],
        sourceRefs: snapshots.map((snapshot) => snapshot.id)
      };
    }
    const dated = snapshots.filter((snapshot) => snapshot.publishedAt);
    if (dated.length !== snapshots.length || dated.length === 0) {
      return {
        id: "time_coverage",
        status: "unknown",
        reasonCodes: ["source_publication_time_incomplete"],
        sourceRefs: dated.map((snapshot) => snapshot.id)
      };
    }
    const from = brief.timeBoundary.from
      ? new Date(brief.timeBoundary.from).getTime()
      : Number.NEGATIVE_INFINITY;
    const to = brief.timeBoundary.to
      ? new Date(brief.timeBoundary.to).getTime()
      : Number.POSITIVE_INFINITY;
    const inRange = dated.filter((snapshot) => {
      const at = new Date(snapshot.publishedAt as string).getTime();
      return Number.isFinite(at) && at >= from && at <= to;
    });
    return {
      id: "time_coverage",
      status: inRange.length === dated.length ? "passed" : "failed",
      reasonCodes:
        inRange.length === dated.length
          ? ["source_publication_time_aligned"]
          : ["source_publication_time_out_of_range"],
      sourceRefs: inRange.map((snapshot) => snapshot.id)
    };
  }

  private counterEvidence(
    brief: ResearchBrief,
    snapshots: ResearchSourceSnapshotRecord[]
  ): ResearchCoverageObligation {
    if (!brief.requireCounterEvidence) {
      return {
        id: "counter_evidence",
        status: "passed",
        reasonCodes: ["counter_evidence_not_required"],
        sourceRefs: []
      };
    }
    const counter = snapshots.filter(
      (snapshot) => snapshot.providerMetadata.queryKind === "counter_evidence"
    );
    return {
      id: "counter_evidence",
      status: counter.length > 0 ? "passed" : "failed",
      reasonCodes:
        counter.length > 0
          ? ["counter_evidence_source_present"]
          : ["counter_evidence_source_missing"],
      sourceRefs: counter.map((snapshot) => snapshot.id)
    };
  }
}
