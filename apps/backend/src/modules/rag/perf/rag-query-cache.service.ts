import { Injectable } from "@nestjs/common";
import type { RagCacheStage } from "./rag-cache-key.factory";

interface RagCacheEntry<T> {
  key: string;
  stage: RagCacheStage;
  datasourceId: string;
  indexVersionId: string;
  value: T;
  expiresAt: number;
  l1TtlMs: number;
}

export interface RagCacheStats {
  hits: number;
  misses: number;
  writes: number;
  evictions: number;
}

export interface RagCacheReadResult<T> {
  hit: boolean;
  value?: T;
}

@Injectable()
export class RagQueryCacheService {
  private readonly l1 = new Map<string, RagCacheEntry<unknown>>();
  private readonly l2 = new Map<string, RagCacheEntry<unknown>>();
  private readonly stats: RagCacheStats = {
    hits: 0,
    misses: 0,
    writes: 0,
    evictions: 0
  };

  get<T>(key: string): RagCacheReadResult<T> {
    const now = Date.now();
    const l1Entry = this.l1.get(key);
    if (this.isHit("l1", l1Entry, now)) {
      this.stats.hits += 1;
      return {
        hit: true,
        value: this.cloneValue(l1Entry.value as T)
      };
    }

    const l2Entry = this.l2.get(key);
    if (this.isHit("l2", l2Entry, now)) {
      this.stats.hits += 1;
      this.l1.set(key, {
        ...l2Entry,
        value: this.cloneValue(l2Entry.value),
        expiresAt: now + Math.max(1, l2Entry.l1TtlMs)
      });
      return {
        hit: true,
        value: this.cloneValue(l2Entry.value as T)
      };
    }

    this.stats.misses += 1;
    return {
      hit: false
    };
  }

  set<T>(input: {
    key: string;
    stage: RagCacheStage;
    datasourceId: string;
    indexVersionId: string;
    value: T;
    l1TtlMs: number;
    l2TtlMs: number;
  }): void {
    const now = Date.now();
    const entry: RagCacheEntry<T> = {
      key: input.key,
      stage: input.stage,
      datasourceId: input.datasourceId.trim(),
      indexVersionId: input.indexVersionId.trim(),
      value: this.cloneValue(input.value),
      expiresAt: now + Math.max(1, Math.floor(input.l1TtlMs)),
      l1TtlMs: Math.max(1, Math.floor(input.l1TtlMs))
    };
    this.l1.set(input.key, entry);
    this.l2.set(input.key, {
      ...entry,
      expiresAt: now + Math.max(1, Math.floor(input.l2TtlMs))
    });
    this.stats.writes += 1;
  }

  pruneDatasourceStaleVersions(datasourceId: string, activeIndexVersionId: string): void {
    const normalizedDatasourceId = datasourceId.trim();
    const normalizedIndexVersionId = activeIndexVersionId.trim();
    this.evictWhere(this.l1, (entry) => {
      return (
        entry.datasourceId === normalizedDatasourceId &&
        entry.indexVersionId !== normalizedIndexVersionId
      );
    });
    this.evictWhere(this.l2, (entry) => {
      return (
        entry.datasourceId === normalizedDatasourceId &&
        entry.indexVersionId !== normalizedIndexVersionId
      );
    });
  }

  snapshotStats(): RagCacheStats {
    return { ...this.stats };
  }

  reset(): void {
    this.l1.clear();
    this.l2.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.writes = 0;
    this.stats.evictions = 0;
  }

  private evictWhere(
    store: Map<string, RagCacheEntry<unknown>>,
    predicate: (entry: RagCacheEntry<unknown>) => boolean
  ): void {
    for (const [key, entry] of store.entries()) {
      if (predicate(entry)) {
        store.delete(key);
        this.stats.evictions += 1;
      }
    }
  }

  private isHit(
    level: "l1" | "l2",
    entry: RagCacheEntry<unknown> | undefined,
    now: number
  ): entry is RagCacheEntry<unknown> {
    if (!entry) {
      return false;
    }
    if (entry.expiresAt <= now) {
      if (level === "l1") {
        this.l1.delete(entry.key);
      } else {
        this.l2.delete(entry.key);
      }
      this.stats.evictions += 1;
      return false;
    }
    return true;
  }

  private cloneValue<T>(input: T): T {
    return JSON.parse(JSON.stringify(input)) as T;
  }
}
