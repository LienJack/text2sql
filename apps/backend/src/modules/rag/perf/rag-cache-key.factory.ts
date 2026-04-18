import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";

export type RagCacheStage = "retrieval_bundle" | "rerank_bundle";

export interface RagCacheKeyInput {
  stage: RagCacheStage;
  datasourceId: string;
  indexVersionId: string;
  query: string;
  budgetProfile?: string;
  perLaneLimit?: number;
  finalCandidateLimit?: number;
  secondaryTopK?: number;
  selectedContextLimit?: number;
}

@Injectable()
export class RagCacheKeyFactory {
  build(input: RagCacheKeyInput): string {
    const datasourceId = input.datasourceId.trim().toLowerCase();
    const indexVersionId = input.indexVersionId.trim().toLowerCase();
    const queryHash = this.hash(this.normalizeQuery(input.query));
    const parts = [
      `stage=${input.stage}`,
      `ds=${datasourceId}`,
      `idx=${indexVersionId}`,
      `q=${queryHash}`
    ];

    if (typeof input.perLaneLimit === "number") {
      parts.push(`pll=${Math.max(0, Math.floor(input.perLaneLimit))}`);
    }
    if (typeof input.finalCandidateLimit === "number") {
      parts.push(`fcl=${Math.max(0, Math.floor(input.finalCandidateLimit))}`);
    }
    if (typeof input.secondaryTopK === "number") {
      parts.push(`stk=${Math.max(0, Math.floor(input.secondaryTopK))}`);
    }
    if (typeof input.selectedContextLimit === "number") {
      parts.push(`scl=${Math.max(0, Math.floor(input.selectedContextLimit))}`);
    }
    if (typeof input.budgetProfile === "string" && input.budgetProfile.trim()) {
      parts.push(`bp=${input.budgetProfile.trim().toLowerCase()}`);
    }

    return parts.join("|");
  }

  private normalizeQuery(input: string): string {
    return input.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private hash(input: string): string {
    return createHash("sha256").update(input).digest("hex").slice(0, 24);
  }
}
