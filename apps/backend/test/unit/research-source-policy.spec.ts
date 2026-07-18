import { DomainError } from "../../src/common/domain-error";
import { AppConfigService } from "../../src/modules/config/app-config.service";
import type { ResearchSourcePolicyRecord } from "../../src/modules/knowledge/research/contracts/research.types";
import { ResearchSourcePolicyService } from "../../src/modules/knowledge/research/source-policy/research-source-policy.service";
import { AnalysisLedgerPrismaService } from "../../src/modules/platform/data/persistence/analysis-ledger-prisma.service";

describe("ResearchSourcePolicyService", () => {
  const service = new ResearchSourcePolicyService(
    {} as AnalysisLedgerPrismaService,
    {} as AppConfigService
  );
  const policy = sourcePolicy();

  it("normalizes locators and removes fragments and non-allowlisted query params", () => {
    const authorized = service.authorizeUrl(
      "https://NEWS.Example.com/report?utm_source=x&lang=zh#section",
      policy
    );

    expect(authorized.canonicalUrl).toBe(
      "https://news.example.com/report?lang=zh"
    );
    expect(authorized.hostname).toBe("news.example.com");
  });

  it.each([
    ["https://user:password@news.example.com/report", "research_url_credentials_denied"],
    ["javascript:alert(1)", "research_url_scheme_denied"],
    ["http://127.0.0.1/admin", "research_url_private_target_denied"],
    ["http://169.254.169.254/latest", "research_url_private_target_denied"],
    ["https://evil.test/report", "research_url_domain_denied"],
    ["https://news.example.com/report?token=do-not-log", "research_url_sensitive_query_denied"]
  ])("rejects unsafe URL without echoing it: %s", (url, reasonCode) => {
    try {
      service.authorizeUrl(url, policy);
      throw new Error("expected policy rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      const denied = error as DomainError;
      expect(denied.details?.reasonCode).toBe(reasonCode);
      expect(denied.message).not.toContain(url);
      expect(denied.message).not.toContain("do-not-log");
    }
  });
});

function sourcePolicy(): ResearchSourcePolicyRecord {
  return {
    id: "policy-1",
    workspaceId: "workspace-1",
    connectorConfigId: "connector-1",
    version: 1,
    status: "active",
    allowedDomains: ["example.com"],
    deniedDomains: ["blocked.example.com"],
    allowedQueryParams: ["lang"],
    allowedMimeTypes: ["text/markdown", "text/plain"],
    maxRedirects: 2,
    maxContentBytes: 100_000,
    retentionDays: 30,
    minIndependentSources: 2,
    requireCounterEvidence: true,
    policyDigest: "policy-digest",
    createdByActorId: "actor-1",
    effectiveAt: "2026-07-17T00:00:00.000Z",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    connector: {
      id: "connector-1",
      workspaceId: "workspace-1",
      provider: "tavily",
      version: 1,
      status: "active",
      hasApiKey: true,
      configDigest: "connector-digest",
      metadata: {},
      createdByActorId: "actor-1",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z"
    }
  };
}
