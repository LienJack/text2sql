import { Injectable } from "@nestjs/common";
import type { RagRetrievalBundle } from "../../rag/retrieval/rag-retrieval.types";
import { SemanticRegistryService } from "../../semantic-registry/semantic-registry.service";
import {
  SEMANTIC_REGISTRY_DEGRADED_RISK_TAG,
  SEMANTIC_TERM_NOT_FOUND_REASON,
  SEMANTIC_VERSION_NOT_FOUND_REASON
} from "../../semantic-registry/semantic-registry.service";

export type PlannerLockStatus = "locked" | "fallback" | "degraded";

export interface PlannerVersionLockInput {
  question: string;
  retrievalBundle?: RagRetrievalBundle;
  requestedSemanticVersion?: number;
}

export interface PlannerVersionLockResult {
  lockStatus: PlannerLockStatus;
  semanticVersion?: number;
  requestedSemanticVersion?: number;
  fallbackApplied: boolean;
  degradeReason?: string;
  riskTags: string[];
  domain: string;
  term: string;
}

@Injectable()
export class PlannerVersionLockService {
  constructor(private readonly semanticRegistry: SemanticRegistryService) {}

  async resolve(input: PlannerVersionLockInput): Promise<PlannerVersionLockResult> {
    const { domain, term, datasourceId } = this.resolveDomainAndTerm(input);
    const requestedSemanticVersion =
      typeof input.requestedSemanticVersion === "number" &&
      Number.isInteger(input.requestedSemanticVersion) &&
      input.requestedSemanticVersion > 0
        ? input.requestedSemanticVersion
        : undefined;

    if (requestedSemanticVersion) {
      const requested = await this.semanticRegistry.resolveTerm({
        domain,
        term,
        semanticVersion: requestedSemanticVersion,
        datasourceId
      });
      if (requested.status === "ready") {
        return {
          lockStatus: "locked",
          semanticVersion: requested.semantic_version,
          requestedSemanticVersion,
          fallbackApplied: false,
          riskTags: requested.risk_tags,
          domain,
          term
        };
      }

      if (requested.degrade_reason === SEMANTIC_VERSION_NOT_FOUND_REASON) {
        const fallback = await this.semanticRegistry.resolveTerm({
          domain,
          term,
          datasourceId
        });
        if (fallback.status === "ready") {
          return {
            lockStatus: "fallback",
            semanticVersion: fallback.semantic_version,
            requestedSemanticVersion,
            fallbackApplied: true,
            degradeReason: requested.degrade_reason,
            riskTags: this.mergeRiskTags(
              [SEMANTIC_REGISTRY_DEGRADED_RISK_TAG],
              requested.risk_tags,
              fallback.risk_tags
            ),
            domain,
            term
          };
        }
      }

      return {
        lockStatus: "degraded",
        semanticVersion: requested.semantic_version,
        requestedSemanticVersion,
        fallbackApplied: false,
        degradeReason: requested.degrade_reason ?? SEMANTIC_VERSION_NOT_FOUND_REASON,
        riskTags: this.mergeRiskTags([SEMANTIC_REGISTRY_DEGRADED_RISK_TAG], requested.risk_tags),
        domain,
        term
      };
    }

    const resolved = await this.semanticRegistry.resolveTerm({
      domain,
      term,
      datasourceId
    });
    if (resolved.status === "ready") {
      return {
        lockStatus: "locked",
        semanticVersion: resolved.semantic_version,
        requestedSemanticVersion: undefined,
        fallbackApplied: false,
        riskTags: resolved.risk_tags,
        domain,
        term
      };
    }

    return {
      lockStatus: "degraded",
      semanticVersion: resolved.semantic_version,
      requestedSemanticVersion: undefined,
      fallbackApplied: false,
      degradeReason: resolved.degrade_reason ?? SEMANTIC_TERM_NOT_FOUND_REASON,
      riskTags: this.mergeRiskTags([SEMANTIC_REGISTRY_DEGRADED_RISK_TAG], resolved.risk_tags),
      domain,
      term
    };
  }

  private resolveDomainAndTerm(input: PlannerVersionLockInput): {
    domain: string;
    term: string;
    datasourceId?: string;
  } {
    const bundle = input.retrievalBundle;
    const fromSkillContext = bundle?.skill_context?.context.at(0);
    const fromSelectedContext = bundle?.selected_context?.at(0);
    const sourceMetadata = fromSelectedContext?.metadata.sourceMetadata;
    const domain =
      fromSkillContext?.domain ??
      fromSelectedContext?.metadata.domain ??
      bundle?.candidates.at(0)?.chunk.metadata.domain ??
      "semantic_term";
    const datasourceId =
      bundle?.datasource_id ??
      fromSelectedContext?.metadata.datasourceId ??
      (typeof sourceMetadata?.datasourceId === "string"
        ? sourceMetadata.datasourceId
        : undefined);
    const semanticHint =
      typeof sourceMetadata?.glossaryTerm === "string"
        ? sourceMetadata.glossaryTerm
        : typeof sourceMetadata?.term === "string"
          ? sourceMetadata.term
          : undefined;

    const term =
      fromSkillContext?.term ??
      semanticHint ??
      this.extractFirstToken(input.question) ??
      "default";

    return {
      domain: domain.trim().toLowerCase(),
      term: term.trim().toLowerCase(),
      datasourceId: datasourceId?.trim() || undefined
    };
  }

  private extractFirstToken(question: string): string | undefined {
    const tokens = question
      .toLowerCase()
      .match(/[a-z0-9_\p{L}\p{N}]+/gu);
    return tokens?.at(0);
  }

  private mergeRiskTags(...groups: Array<string[] | undefined>): string[] {
    const merged = new Set<string>();
    for (const group of groups) {
      for (const riskTag of group ?? []) {
        const normalized = riskTag.trim();
        if (normalized) {
          merged.add(normalized);
        }
      }
    }
    return [...merged];
  }
}
