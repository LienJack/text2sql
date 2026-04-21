import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";

export type PlannerCacheStatus = "hit" | "miss" | "stale";

export interface PlannerCacheEntry {
  cacheKey: string;
  datasourceId: string;
  queryHash: string;
  semanticVersion: number;
  strategy: "direct_sql" | "fallback_sql";
  summary: string;
  createdAt: string;
  expiresAt: string;
}

export interface PlannerCacheLookupResult {
  status: PlannerCacheStatus;
  cacheKey: string;
  reason?: string;
  entry?: PlannerCacheEntry;
}

const DEFAULT_TTL_SECONDS = 15 * 60;

@Injectable()
export class PlannerCacheService {
  private readonly entries = new Map<string, PlannerCacheEntry>();

  lookup(input: {
    datasourceId: string;
    question: string;
    semanticVersion?: number;
  }): PlannerCacheLookupResult {
    if (!input.semanticVersion) {
      return {
        status: "miss",
        cacheKey: this.buildCacheKey(input.datasourceId, input.question, 0),
        reason: "semantic_version_missing"
      };
    }
    const cacheKey = this.buildCacheKey(
      input.datasourceId,
      input.question,
      input.semanticVersion
    );
    const entry = this.entries.get(cacheKey);
    if (!entry) {
      return {
        status: "miss",
        cacheKey,
        reason: "cache_not_found"
      };
    }
    if (Date.parse(entry.expiresAt) <= Date.now()) {
      this.entries.delete(cacheKey);
      return {
        status: "stale",
        cacheKey,
        reason: "cache_expired"
      };
    }
    return {
      status: "hit",
      cacheKey,
      entry: { ...entry }
    };
  }

  store(input: {
    datasourceId: string;
    question: string;
    semanticVersion: number;
    strategy: "direct_sql" | "fallback_sql";
    summary: string;
    ttlSeconds?: number;
  }): PlannerCacheEntry {
    const now = new Date();
    const ttlSeconds =
      typeof input.ttlSeconds === "number" && input.ttlSeconds > 0
        ? Math.floor(input.ttlSeconds)
        : DEFAULT_TTL_SECONDS;
    const queryHash = this.hashQuery(input.question);
    const cacheKey = this.buildCacheKey(
      input.datasourceId,
      input.question,
      input.semanticVersion
    );
    const entry: PlannerCacheEntry = {
      cacheKey,
      datasourceId: input.datasourceId.trim(),
      queryHash,
      semanticVersion: input.semanticVersion,
      strategy: input.strategy,
      summary: input.summary,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString()
    };
    this.entries.set(cacheKey, entry);
    return { ...entry };
  }

  invalidateByDatasourceAndSemanticVersion(
    datasourceId: string,
    semanticVersion: number
  ): number {
    let removed = 0;
    for (const [cacheKey, entry] of this.entries.entries()) {
      if (entry.datasourceId !== datasourceId || entry.semanticVersion === semanticVersion) {
        continue;
      }
      this.entries.delete(cacheKey);
      removed += 1;
    }
    return removed;
  }

  private buildCacheKey(
    datasourceId: string,
    question: string,
    semanticVersion: number
  ): string {
    const normalizedDatasource = datasourceId.trim().toLowerCase();
    const queryHash = this.hashQuery(question);
    return `${normalizedDatasource}:${queryHash}:v${semanticVersion}`;
  }

  private hashQuery(question: string): string {
    return createHash("sha256")
      .update(question.trim().toLowerCase())
      .digest("hex");
  }
}
