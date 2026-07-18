import type {
  ResearchExtractResult,
  ResearchQueryKind,
  ResearchSearchResult,
  ResearchTimeBoundary
} from "./research.types";

export abstract class ResearchConnectorPort {
  abstract readonly provider: "tavily";

  abstract search(input: {
    query: string;
    queryKind: ResearchQueryKind;
    maxResults: number;
    allowedDomains: string[];
    deniedDomains: string[];
    timeBoundary?: ResearchTimeBoundary;
    timeoutMs: number;
  }): Promise<ResearchSearchResult>;

  abstract extract(input: {
    urls: string[];
    query: string;
    timeoutMs: number;
  }): Promise<ResearchExtractResult>;
}
