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
  workspaceId?: string;
  allowedTables?: string[];
  allowedColumnsDigest?: string;
  policyVersion?: number;
  policyDigest?: string;
  schemaSnapshotDigest?: string;
  semanticVersion?: number;
  modelingRevision?: number;
  valueSketchVersion?: string;
  priorSqlVersion?: string;
  modelVersion?: string;
  promptVersion?: string;
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
    const identity = {
      workspaceId: input.workspaceId?.trim().toLowerCase(),
      allowedTables: [...(input.allowedTables ?? [])]
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .sort(),
      allowedColumnsDigest: input.allowedColumnsDigest?.trim().toLowerCase(),
      policyVersion: input.policyVersion,
      policyDigest: input.policyDigest?.trim().toLowerCase(),
      schemaSnapshotDigest: input.schemaSnapshotDigest?.trim().toLowerCase(),
      semanticVersion: input.semanticVersion,
      modelingRevision: input.modelingRevision,
      valueSketchVersion: input.valueSketchVersion?.trim().toLowerCase(),
      priorSqlVersion: input.priorSqlVersion?.trim().toLowerCase(),
      modelVersion: input.modelVersion?.trim().toLowerCase(),
      promptVersion: input.promptVersion?.trim().toLowerCase()
    };
    if (Object.values(identity).some((value) => value !== undefined)) {
      parts.push(`identity=${this.hash(JSON.stringify(identity))}`);
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
