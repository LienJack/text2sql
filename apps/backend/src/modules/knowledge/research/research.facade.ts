import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import { AppConfigService } from "../../config/app-config.service";
import { stableJson } from "../../platform/data/persistence/analysis-ledger.util";
import { ResearchConnectorPort } from "./contracts/research-connector.port";
import type {
  ResearchBrief,
  ResearchQueryKind,
  ResearchRunResult,
  ResearchSearchCandidate,
  ResearchSourcePolicyRecord,
  ResearchSourceSnapshotRecord,
  ResearchTimeBoundary
} from "./contracts/research.types";
import { ResearchCoverageService } from "./research-coverage.service";
import { ResearchSourceSnapshotService } from "./source-snapshot.service";
import { ResearchSourcePolicyService } from "./source-policy/research-source-policy.service";

@Injectable()
export class ResearchFacade {
  constructor(
    private readonly config: AppConfigService,
    private readonly connector: ResearchConnectorPort,
    private readonly sourcePolicy: ResearchSourcePolicyService,
    private readonly snapshots: ResearchSourceSnapshotService,
    private readonly coverage: ResearchCoverageService
  ) {}

  async run(input: {
    actor: Express.RequestActor;
    taskId: string;
    revisionId: string;
    workspaceId: string;
    question: string;
    decisionUse: string;
    timeBoundary?: ResearchTimeBoundary;
    stopConditions: string[];
    budget: {
      maxSearchCount: number;
      maxArtifactBytes: number;
    };
  }): Promise<ResearchRunResult> {
    const policy = await this.sourcePolicy.resolveActivePolicy(
      input.workspaceId,
      input.actor.id
    );
    const brief = this.buildBrief(input, policy);
    const providerRequestIds: string[] = [];
    const rejectionReasonCodes: string[] = [];
    const candidates = new Map<string, ResearchSearchCandidate>();
    let searchCount = 0;
    let providerUnavailable = false;

    for (const queryKind of queryKinds(brief)) {
      if (searchCount >= brief.queryBudget) {
        break;
      }
      try {
        const result = await this.connector.search({
          query:
            queryKind === "counter_evidence"
              ? `${brief.question}\n寻找反证、冲突、替代解释与不支持该结论的来源。`
              : brief.question,
          queryKind,
          maxResults: brief.resultBudget,
          allowedDomains: policy.allowedDomains,
          deniedDomains: policy.deniedDomains,
          timeBoundary: brief.timeBoundary,
          timeoutMs: this.config.analysisResearchSearchTimeoutMs
        });
        searchCount += 1;
        providerRequestIds.push(result.requestId);
        this.collectAuthorizedCandidates(result.candidates, policy, candidates, rejectionReasonCodes);
      } catch (error) {
        providerUnavailable = isProviderUnavailable(error);
        rejectionReasonCodes.push(reasonCode(error));
        break;
      }
    }

    const selected = [...candidates.entries()].slice(0, brief.extractBudget);
    const frozen: ResearchSourceSnapshotRecord[] = [];
    if (!providerUnavailable && selected.length > 0) {
      try {
        const extracted = await this.connector.extract({
          urls: selected.map(([canonicalUrl]) => canonicalUrl),
          query: brief.question,
          timeoutMs: this.config.analysisResearchExtractTimeoutMs
        });
        providerRequestIds.push(extracted.requestId);
        rejectionReasonCodes.push(
          ...extracted.failures.map((failure) => failure.reasonCode)
        );
        let remainingBytes = brief.contentByteBudget;
        for (const source of extracted.sources) {
          if (remainingBytes <= 0) {
            rejectionReasonCodes.push("research_content_budget_exhausted");
            break;
          }
          try {
            const authorized = this.sourcePolicy.authorizeUrl(source.url, policy);
            const candidate = candidates.get(authorized.canonicalUrl);
            const snapshot = await this.snapshots.freeze({
              policy,
              taskId: brief.taskId,
              revisionId: brief.revisionId,
              source,
              providerRequestId: extracted.requestId,
              queryKind: candidate?.queryKind ?? "primary",
              publishedAt: candidate?.publishedAt,
              relevanceScore: candidate?.relevanceScore,
              contentByteBudget: remainingBytes
            });
            frozen.push(snapshot);
            remainingBytes -= snapshot.contentSizeBytes;
          } catch (error) {
            rejectionReasonCodes.push(reasonCode(error));
          }
        }
      } catch (error) {
        providerUnavailable = isProviderUnavailable(error);
        rejectionReasonCodes.push(reasonCode(error));
      }
    }

    const budgetExhausted =
      searchCount >= brief.queryBudget ||
      frozen.reduce((sum, snapshot) => sum + snapshot.contentSizeBytes, 0) >=
        brief.contentByteBudget;
    const coverage = this.coverage.evaluate({
      brief,
      snapshots: frozen,
      rejectionReasonCodes,
      providerUnavailable,
      budgetExhausted
    });
    return {
      brief,
      snapshots: frozen,
      coverage,
      providerRequestIds: [...new Set(providerRequestIds)],
      queryCount: searchCount,
      searchCount,
      artifactBytes: Buffer.byteLength(
        stableJson({ brief, snapshots: frozen, coverage }),
        "utf8"
      )
    };
  }

  private buildBrief(
    input: {
      taskId: string;
      revisionId: string;
      workspaceId: string;
      question: string;
      decisionUse: string;
      timeBoundary?: ResearchTimeBoundary;
      stopConditions: string[];
      budget: { maxSearchCount: number; maxArtifactBytes: number };
    },
    policy: ResearchSourcePolicyRecord
  ): ResearchBrief {
    const queryBudget = Math.max(1, Math.min(input.budget.maxSearchCount, 20));
    return {
      version: "research-brief.v1",
      taskId: input.taskId,
      revisionId: input.revisionId,
      workspaceId: input.workspaceId,
      question: input.question,
      decisionUse: input.decisionUse,
      timeBoundary: input.timeBoundary,
      policyId: policy.id,
      policyDigest: policy.policyDigest,
      connectorConfigId: policy.connectorConfigId,
      connectorConfigDigest: policy.connector.configDigest,
      queryBudget,
      resultBudget: Math.max(2, Math.min(10, queryBudget * 5)),
      extractBudget: Math.max(1, Math.min(20, queryBudget * 5)),
      contentByteBudget: Math.max(
        1,
        Math.min(input.budget.maxArtifactBytes, policy.maxContentBytes * 20)
      ),
      minIndependentSources: policy.minIndependentSources,
      requireCounterEvidence: policy.requireCounterEvidence,
      stopConditions: [...input.stopConditions]
    };
  }

  private collectAuthorizedCandidates(
    incoming: ResearchSearchCandidate[],
    policy: ResearchSourcePolicyRecord,
    target: Map<string, ResearchSearchCandidate>,
    rejectionReasonCodes: string[]
  ): void {
    for (const candidate of incoming) {
      try {
        const authorized = this.sourcePolicy.authorizeUrl(candidate.url, policy);
        const existing = target.get(authorized.canonicalUrl);
        target.set(authorized.canonicalUrl, {
          ...candidate,
          url: authorized.canonicalUrl,
          queryKind:
            existing?.queryKind === "counter_evidence" ||
            candidate.queryKind === "counter_evidence"
              ? "counter_evidence"
              : "primary"
        });
      } catch (error) {
        rejectionReasonCodes.push(reasonCode(error));
      }
    }
  }
}

function queryKinds(brief: ResearchBrief): ResearchQueryKind[] {
  return brief.requireCounterEvidence && brief.queryBudget >= 2
    ? ["primary", "counter_evidence"]
    : ["primary"];
}

function reasonCode(error: unknown): string {
  if (error instanceof DomainError) {
    const detailReason = error.details?.reasonCode;
    return typeof detailReason === "string" ? detailReason : error.code;
  }
  return "research_unclassified_failure";
}

function isProviderUnavailable(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    (error.code === "RESEARCH_PROVIDER_NOT_CONFIGURED" ||
      error.code === "RESEARCH_PROVIDER_SEARCH_FAILED" ||
      error.code === "RESEARCH_PROVIDER_EXTRACT_FAILED")
  );
}
