import { PlannerVersionLockService } from "../../src/modules/conversation/agent/planner/planner-version-lock.service";
import type { SemanticRegistryService } from "../../src/modules/semantic-registry/semantic-registry.service";
import {
  SEMANTIC_REGISTRY_DEGRADED_RISK_TAG,
  SEMANTIC_VERSION_NOT_FOUND_REASON
} from "../../src/modules/semantic-registry/semantic-registry.service";

describe("planner version lock service", () => {
  it("locks requested semantic version when it exists", async () => {
    const semanticRegistry = {
      resolveTerm: jest.fn().mockResolvedValue({
        status: "ready",
        semantic_version: 3,
        risk_tags: ["semantic_registry_v3"]
      })
    } as unknown as SemanticRegistryService;
    const service = new PlannerVersionLockService(semanticRegistry);

    const result = await service.resolve({
      question: "GMV 趋势",
      requestedSemanticVersion: 3
    });

    expect(result.lockStatus).toBe("locked");
    expect(result.semanticVersion).toBe(3);
    expect(result.fallbackApplied).toBe(false);
    expect(result.riskTags).toEqual(expect.arrayContaining(["semantic_registry_v3"]));
  });

  it("falls back to active version when requested version is missing", async () => {
    const semanticRegistry = {
      resolveTerm: jest
        .fn()
        .mockResolvedValueOnce({
          status: "degraded",
          semantic_version: 9,
          degrade_reason: SEMANTIC_VERSION_NOT_FOUND_REASON,
          risk_tags: [SEMANTIC_REGISTRY_DEGRADED_RISK_TAG]
        })
        .mockResolvedValueOnce({
          status: "ready",
          semantic_version: 2,
          risk_tags: ["semantic_registry_active"]
        })
    } as unknown as SemanticRegistryService;
    const service = new PlannerVersionLockService(semanticRegistry);

    const result = await service.resolve({
      question: "GMV 统计",
      requestedSemanticVersion: 9
    });

    expect(result.lockStatus).toBe("fallback");
    expect(result.semanticVersion).toBe(2);
    expect(result.fallbackApplied).toBe(true);
    expect(result.degradeReason).toBe(SEMANTIC_VERSION_NOT_FOUND_REASON);
    expect(result.riskTags).toEqual(
      expect.arrayContaining([
        SEMANTIC_REGISTRY_DEGRADED_RISK_TAG,
        "semantic_registry_active"
      ])
    );
  });

  it("returns degraded decision when neither requested nor active version can be resolved", async () => {
    const semanticRegistry = {
      resolveTerm: jest.fn().mockResolvedValue({
        status: "degraded",
        degrade_reason: SEMANTIC_VERSION_NOT_FOUND_REASON,
        risk_tags: [SEMANTIC_REGISTRY_DEGRADED_RISK_TAG]
      })
    } as unknown as SemanticRegistryService;
    const service = new PlannerVersionLockService(semanticRegistry);

    const result = await service.resolve({
      question: "orders 统计",
      requestedSemanticVersion: 99
    });

    expect(result.lockStatus).toBe("degraded");
    expect(result.fallbackApplied).toBe(false);
    expect(result.degradeReason).toBe(SEMANTIC_VERSION_NOT_FOUND_REASON);
    expect(result.riskTags).toContain(SEMANTIC_REGISTRY_DEGRADED_RISK_TAG);
  });
});
