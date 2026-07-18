import type { TavilyClient } from "@tavily/core";
import { AppConfigService } from "../../src/modules/config/app-config.service";
import { TavilyResearchConnector } from "../../src/modules/knowledge/research/connectors/tavily-research.connector";

describe("TavilyResearchConnector", () => {
  it("disables provider answers and raw search content before policy-filtered extract", async () => {
    const search = jest.fn().mockResolvedValue({
      query: "revenue",
      responseTime: 0.1,
      requestId: "search-request-1",
      images: [],
      usage: { credits: 1 },
      results: [
        {
          title: "Report",
          url: "https://news.example.com/report",
          content: "candidate snippet",
          score: 0.9,
          publishedDate: "2026-07-01"
        }
      ]
    });
    const extract = jest.fn().mockResolvedValue({
      requestId: "extract-request-1",
      responseTime: 0.2,
      usage: { credits: 1 },
      results: [
        {
          url: "https://news.example.com/report",
          title: "Report",
          rawContent: "frozen content"
        }
      ],
      failedResults: []
    });
    const client = { search, extract } as unknown as TavilyClient;
    const connector = new TavilyResearchConnector(
      {
        analysisResearchEnabled: true
      } as AppConfigService,
      client
    );

    const candidates = await connector.search({
      query: "revenue",
      queryKind: "primary",
      maxResults: 5,
      allowedDomains: ["example.com"],
      deniedDomains: ["blocked.example.com"],
      timeBoundary: {
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-17T00:00:00.000Z"
      },
      timeoutMs: 10_000
    });
    const content = await connector.extract({
      urls: candidates.candidates.map((candidate) => candidate.url),
      query: "revenue",
      timeoutMs: 20_000
    });

    expect(search).toHaveBeenCalledWith(
      "revenue",
      expect.objectContaining({
        includeAnswer: false,
        includeRawContent: false,
        autoParameters: false,
        includeDomains: ["example.com"],
        excludeDomains: ["blocked.example.com"],
        startDate: "2026-07-01",
        endDate: "2026-07-17"
      })
    );
    expect(extract).toHaveBeenCalledWith(
      ["https://news.example.com/report"],
      expect.objectContaining({
        extractDepth: "basic",
        format: "markdown",
        query: "revenue"
      })
    );
    expect(candidates).not.toHaveProperty("answer");
    expect(content.sources[0]?.content).toBe("frozen content");
  });
});
