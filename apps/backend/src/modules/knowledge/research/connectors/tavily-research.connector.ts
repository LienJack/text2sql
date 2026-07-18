import { Inject, Injectable } from "@nestjs/common";
import type { TavilyClient } from "@tavily/core";
import { DomainError } from "../../../../common/domain-error";
import { AppConfigService } from "../../../config/app-config.service";
import { ResearchConnectorPort } from "../contracts/research-connector.port";
import type {
  ResearchExtractResult,
  ResearchSearchResult
} from "../contracts/research.types";

export const TAVILY_RESEARCH_CLIENT = Symbol("TAVILY_RESEARCH_CLIENT");

@Injectable()
export class TavilyResearchConnector extends ResearchConnectorPort {
  readonly provider = "tavily" as const;

  constructor(
    private readonly config: AppConfigService,
    @Inject(TAVILY_RESEARCH_CLIENT)
    private readonly client: TavilyClient | null
  ) {
    super();
  }

  async search(
    input: Parameters<ResearchConnectorPort["search"]>[0]
  ): Promise<ResearchSearchResult> {
    const client = this.requireClient();
    try {
      const response = await client.search(input.query, {
        searchDepth: "basic",
        maxResults: Math.max(1, Math.min(input.maxResults, 20)),
        includeAnswer: false,
        includeRawContent: false,
        includeImages: false,
        includeFavicon: false,
        includeUsage: true,
        autoParameters: false,
        includeDomains: input.allowedDomains,
        excludeDomains: input.deniedDomains,
        startDate: toDateOnly(input.timeBoundary?.from),
        endDate: toDateOnly(input.timeBoundary?.to),
        timeout: timeoutSeconds(input.timeoutMs),
        clientName: "text2sql-bounded-research"
      });
      return {
        provider: this.provider,
        requestId: response.requestId,
        queryKind: input.queryKind,
        candidates: response.results.map((result) => ({
          queryKind: input.queryKind,
          title: result.title,
          url: result.url,
          ...(result.publishedDate
            ? { publishedAt: normalizePublishedAt(result.publishedDate) }
            : {}),
          relevanceScore: result.score
        })),
        usageCredits: response.usage?.credits
      };
    } catch {
      throw new DomainError(
        "RESEARCH_PROVIDER_SEARCH_FAILED",
        "Research provider search 失败，未返回未过滤的 provider 错误。",
        503
      );
    }
  }

  async extract(
    input: Parameters<ResearchConnectorPort["extract"]>[0]
  ): Promise<ResearchExtractResult> {
    const client = this.requireClient();
    if (input.urls.length === 0) {
      return {
        provider: this.provider,
        requestId: "not-called",
        sources: [],
        failures: []
      };
    }
    try {
      const response = await client.extract(input.urls.slice(0, 20), {
        extractDepth: "basic",
        format: "markdown",
        includeImages: false,
        includeFavicon: false,
        includeUsage: true,
        query: input.query,
        chunksPerSource: 5,
        timeout: timeoutSeconds(input.timeoutMs),
        clientName: "text2sql-bounded-research"
      });
      return {
        provider: this.provider,
        requestId: response.requestId,
        sources: response.results.map((result) => ({
          url: result.url,
          ...(result.title ? { title: result.title } : {}),
          content: result.rawContent,
          mimeType: "text/markdown"
        })),
        failures: response.failedResults.map(() => ({
          reasonCode: "research_extract_failed"
        })),
        usageCredits: response.usage?.credits
      };
    } catch {
      throw new DomainError(
        "RESEARCH_PROVIDER_EXTRACT_FAILED",
        "Research provider extract 失败，未返回未过滤的 provider 错误。",
        503
      );
    }
  }

  private requireClient(): TavilyClient {
    if (!this.config.analysisResearchEnabled || !this.client) {
      throw new DomainError(
        "RESEARCH_PROVIDER_NOT_CONFIGURED",
        "Bounded Deep Search 未启用或 provider key 未配置。",
        503
      );
    }
    return this.client;
  }
}

function timeoutSeconds(timeoutMs: number): number {
  return Math.max(1, Math.min(60, Math.ceil(timeoutMs / 1_000)));
}

function toDateOnly(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toISOString().slice(0, 10);
}

function normalizePublishedAt(value: string): string | undefined {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
