import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { GraphService } from "../../graph/graph.service";
import {
  SKILL_REGISTRY_UNAVAILABLE_REASON,
  SkillRegistryService
} from "../../../skill-registry/skill-registry.service";
import { RagIndexRepository } from "../../../rag/index/rag-index.repository";
import { RagReplayRepository } from "../observability/rag-replay.repository";
import { RagBudgetPolicy } from "../../../rag/perf/rag-budget-policy";
import { RagCacheKeyFactory } from "../../../rag/perf/rag-cache-key.factory";
import { RagQueryCacheService } from "../../../rag/perf/rag-query-cache.service";
import { RagQualityService } from "../../../rag/quality/rag-quality.service";
import { ModelingGraphRepository } from "../../../platform/data/persistence/modeling-graph.repository";
import { fuseWithRrf } from "../../../rag/retrieval/fusion/rrf-fusion";
import {
  RAG_RETRIEVAL_LANES,
  type RagRetrievalCandidate,
  type RagRetrievalChunkMetadata,
  type RagRetrievalChunkPayload,
  type RagRetrievalEntryContext,
  type RagRetrievalLane,
  type RagRetrievalLaneHit,
  type RagRetrievalLaneResult,
  type RagRetrievalRequest,
  type RagRetrievalResponse,
  type RagContextPack,
  type RagSkillContext
} from "../../../rag/retrieval/rag-retrieval.types";

const DEFAULT_PER_LANE_LIMIT = 20;
const DEFAULT_FINAL_CANDIDATE_LIMIT = 20;
const RETRIEVAL_CACHE_L1_TTL_MS = 30_000;
const RETRIEVAL_CACHE_L2_TTL_MS = 5 * 60_000;
const DEFAULT_LANE_TIMEOUT_MS: Record<RagRetrievalLane, number> = {
  lexical: 250,
  dense: 300,
  graph: 300
};
const REQUIRED_DOMAIN_COVERAGE = ["schema", "sql_example", "semantic_term"];
const SEMANTIC_PROMOTED_DEGRADED_REASON = "semantic_promoted_linkage_degraded";
const MODELING_REVISION_MISSING_RISK_TAG = "modeling_revision_missing";

class LaneTimeoutError extends Error {
  constructor(public readonly lane: RagRetrievalLane) {
    super(`${lane} lane timeout`);
  }
}

type LaneExecutionOutput =
  | RagRetrievalLaneHit[]
  | {
      hits: RagRetrievalLaneHit[];
      degradeReason?: string;
    };

@Injectable()
export class RagRetrievalService {
  constructor(
    private readonly indexRepository: RagIndexRepository,
    private readonly replayRepository: RagReplayRepository,
    private readonly skillRegistry: SkillRegistryService,
    private readonly graphService: GraphService,
    private readonly cacheKeyFactory: RagCacheKeyFactory,
    private readonly queryCache: RagQueryCacheService,
    private readonly budgetPolicy: RagBudgetPolicy,
    private readonly ragQualityService: RagQualityService,
    private readonly modelingGraphRepository: ModelingGraphRepository
  ) {}

  async retrieve(input: RagRetrievalRequest): Promise<RagRetrievalResponse> {
    const query = input.query.trim();
    const datasourceId = input.datasourceId.trim();
    const runId = input.runId.trim();
    const requestedPerLaneLimit = this.normalizeLimit(input.perLaneLimit, DEFAULT_PER_LANE_LIMIT);
    const requestedFinalCandidateLimit = this.normalizeLimit(
      input.finalCandidateLimit,
      DEFAULT_FINAL_CANDIDATE_LIMIT
    );
    const laneTimeoutMs = this.resolveLaneTimeoutMs(input);

    if (!query || !datasourceId || !runId) {
      const degradeReasons = ["invalid_retrieval_input"];
      return {
        retrieval_bundle: {
          query,
          run_id: runId,
          datasource_id: datasourceId,
          status: "degraded",
          degrade_reasons: degradeReasons,
          lane_results: this.createEmptyLaneResults(laneTimeoutMs, "invalid_retrieval_input"),
          candidates: [],
          context_pack: await this.buildContextPack({
            workspaceId: input.workspaceId,
            datasourceId,
            status: "degraded",
            degradeReasons
          })
        }
      };
    }

    const activeVersion = input.activeIndexVersionId?.trim()
      ? await this.indexRepository.getVersionById(input.activeIndexVersionId.trim())
      : await this.indexRepository.getActiveVersion(datasourceId);
    if (!activeVersion || activeVersion.status !== "active") {
      const degradeReasons = ["no_active_index"];
      const response: RagRetrievalResponse = {
        retrieval_bundle: {
          query,
          run_id: runId,
          datasource_id: datasourceId,
          index_version_id: activeVersion?.id,
          status: "degraded",
          degrade_reasons: degradeReasons,
          lane_results: this.createEmptyLaneResults(laneTimeoutMs, "no_active_index"),
          candidates: [],
          context_pack: await this.buildContextPack({
            workspaceId: input.workspaceId,
            datasourceId,
            status: "degraded",
            degradeReasons
          })
        }
      };
      await this.persistReplay(response.retrieval_bundle);
      return response;
    }

    this.queryCache.pruneDatasourceStaleVersions(datasourceId, activeVersion.id);
    const budgetDecision = this.budgetPolicy.planRetrieval({
      requestedPerLaneLimit,
      requestedFinalCandidateLimit,
      signal: input.budgetSignal
    });
    const perLaneLimit = budgetDecision.perLaneLimit;
    const finalCandidateLimit = budgetDecision.finalCandidateLimit;
    const budgetLaneProfile = budgetDecision.enabledLanes.join("+");
    await this.writeBudgetReplay({
      runId,
      datasourceId,
      indexVersionId: activeVersion.id,
      decisionReasons: budgetDecision.decisionReasons,
      perLaneLimit,
      finalCandidateLimit,
      enabledLanes: budgetDecision.enabledLanes
    });

    const cacheKey = this.cacheKeyFactory.build({
      stage: "retrieval_bundle",
      datasourceId,
      indexVersionId: activeVersion.id,
      query,
      budgetProfile: budgetLaneProfile,
      perLaneLimit,
      finalCandidateLimit
    });
    const cacheRead = this.queryCache.get<RagRetrievalResponse["retrieval_bundle"]>(cacheKey);
    if (cacheRead.hit && cacheRead.value) {
      const cachedBundle = await this.hydrateCachedBundle({
        cachedBundle: cacheRead.value,
        query,
        datasourceId,
        workspaceId: input.workspaceId,
        runId,
        decisionReasons: budgetDecision.decisionReasons
      });
      this.ragQualityService.recordCacheBudget({
        cacheEligible: true,
        cacheHit: true,
        budgetDegraded: budgetDecision.degraded
      });
      await this.persistReplay(cachedBundle);
      return {
        retrieval_bundle: cachedBundle
      };
    }

    const entries = await this.indexRepository.listEntriesByVersion(activeVersion.id);
    const contexts = entries.map((entry) => this.toEntryContext(activeVersion.id, entry));
    const laneResults = await this.collectLaneResults({
      query,
      contexts,
      perLaneLimit,
      laneTimeoutMs,
      enabledLanes: budgetDecision.enabledLanes,
      laneArtificialDelayMs: input.laneArtificialDelayMs
    });

    const laneHits = {
      lexical: laneResults.lexical.hits,
      dense: laneResults.dense.hits,
      graph: laneResults.graph.hits
    };
    const fused = fuseWithRrf({ laneHits });
    const coveredCandidates = this.applyDomainCoverage(
      fused,
      finalCandidateLimit,
      REQUIRED_DOMAIN_COVERAGE
    );
    const candidates = this.decorateSemanticCandidates(coveredCandidates);
    const skillContext = await this.resolveSkillContext(query, candidates);

    const degradeReasons = this.collectDegradeReasons(laneResults);
    degradeReasons.push(...this.collectSemanticLinkageDegradeReasons(candidates));
    if (skillContext.degrade_reason) {
      degradeReasons.push(skillContext.degrade_reason);
    }
    if (candidates.length === 0) {
      degradeReasons.push("zero_recall");
    }
    const uniqueDegradeReasons = this.unique([
      ...degradeReasons,
      ...budgetDecision.decisionReasons
    ]);

    const response: RagRetrievalResponse = {
      retrieval_bundle: {
        query,
        run_id: runId,
        datasource_id: datasourceId,
        index_version_id: activeVersion.id,
        status: uniqueDegradeReasons.length > 0 ? "degraded" : "ready",
        degrade_reasons: uniqueDegradeReasons,
        lane_results: laneResults,
        candidates,
        skill_context: skillContext,
        decision_reasons: budgetDecision.decisionReasons
      }
    };
    response.retrieval_bundle.context_pack = await this.buildContextPack({
      bundle: response.retrieval_bundle,
      workspaceId: input.workspaceId,
      datasourceId,
      status: response.retrieval_bundle.status,
      degradeReasons: uniqueDegradeReasons
    });

    this.queryCache.set({
      key: cacheKey,
      stage: "retrieval_bundle",
      datasourceId,
      indexVersionId: activeVersion.id,
      value: response.retrieval_bundle,
      l1TtlMs: RETRIEVAL_CACHE_L1_TTL_MS,
      l2TtlMs: RETRIEVAL_CACHE_L2_TTL_MS
    });
    this.ragQualityService.recordCacheBudget({
      cacheEligible: true,
      cacheHit: false,
      budgetDegraded: budgetDecision.degraded
    });
    await this.persistReplay(response.retrieval_bundle);
    return response;
  }

  private async hydrateCachedBundle(input: {
    cachedBundle: RagRetrievalResponse["retrieval_bundle"];
    query: string;
    datasourceId: string;
    workspaceId?: string;
    runId: string;
    decisionReasons: string[];
  }): Promise<RagRetrievalResponse["retrieval_bundle"]> {
    const hydratedBundle: RagRetrievalResponse["retrieval_bundle"] = {
      ...input.cachedBundle,
      query: input.query,
      datasource_id: input.datasourceId,
      run_id: input.runId,
      decision_reasons: this.unique([
        ...(input.cachedBundle.decision_reasons ?? []),
        ...input.decisionReasons,
        "cache_hit"
      ]),
      degrade_reasons: this.unique([
        ...(input.cachedBundle.degrade_reasons ?? []),
        ...input.decisionReasons
      ])
    };
    hydratedBundle.context_pack = await this.buildContextPack({
      bundle: hydratedBundle,
      workspaceId: input.workspaceId,
      datasourceId: input.datasourceId,
      status: hydratedBundle.status,
      degradeReasons: hydratedBundle.degrade_reasons
    });
    return hydratedBundle;
  }

  private async collectLaneResults(input: {
    query: string;
    contexts: RagRetrievalEntryContext[];
    perLaneLimit: number;
    laneTimeoutMs: Record<RagRetrievalLane, number>;
    enabledLanes: RagRetrievalLane[];
    laneArtificialDelayMs?: Partial<Record<RagRetrievalLane, number>>;
  }): Promise<Record<RagRetrievalLane, RagRetrievalLaneResult>> {
    const enabledLanes = new Set(input.enabledLanes);
    const lexicalPromise = enabledLanes.has("lexical")
      ? this.executeLane("lexical", input, () =>
          this.runLexicalLane(input.query, input.contexts, input.perLaneLimit)
        )
      : Promise.resolve(this.createBudgetDisabledLaneResult("lexical", input.laneTimeoutMs.lexical));
    const densePromise = enabledLanes.has("dense")
      ? this.executeLane("dense", input, () =>
          this.runDenseLane(input.query, input.contexts, input.perLaneLimit)
        )
      : Promise.resolve(this.createBudgetDisabledLaneResult("dense", input.laneTimeoutMs.dense));
    const graphPromise = enabledLanes.has("graph")
      ? this.executeLane("graph", input, () =>
          this.runGraphLane(input.query, input.contexts, input.perLaneLimit)
        )
      : Promise.resolve(this.createBudgetDisabledLaneResult("graph", input.laneTimeoutMs.graph));

    const [lexical, dense, graph] = await Promise.all([
      lexicalPromise,
      densePromise,
      graphPromise
    ]);
    return {
      lexical,
      dense,
      graph
    };
  }

  private createBudgetDisabledLaneResult(
    lane: RagRetrievalLane,
    timeoutMs: number
  ): RagRetrievalLaneResult {
    return {
      lane,
      status: "degraded",
      timeout_ms: timeoutMs,
      elapsed_ms: 0,
      degrade_reason: `budget_lane_disabled_${lane}`,
      hits: []
    };
  }

  private async executeLane(
    lane: RagRetrievalLane,
    input: {
      query: string;
      contexts: RagRetrievalEntryContext[];
      perLaneLimit: number;
      laneTimeoutMs: Record<RagRetrievalLane, number>;
      laneArtificialDelayMs?: Partial<Record<RagRetrievalLane, number>>;
    },
    laneExecutor: () => LaneExecutionOutput | Promise<LaneExecutionOutput>
  ): Promise<RagRetrievalLaneResult> {
    const timeoutMs = input.laneTimeoutMs[lane];
    const startedAt = Date.now();
    try {
      const lanePromise = Promise.resolve().then(async () => {
        const artificialDelayMs = input.laneArtificialDelayMs?.[lane];
        if (typeof artificialDelayMs === "number" && artificialDelayMs > 0) {
          await this.sleep(artificialDelayMs);
        }
        return laneExecutor();
      });
      const laneOutput = await Promise.race([
        lanePromise,
        this.timeout(timeoutMs, lane)
      ]);
      const normalizedOutput = this.normalizeLaneOutput(laneOutput);
      return {
        lane,
        status: normalizedOutput.degradeReason ? "degraded" : "ok",
        timeout_ms: timeoutMs,
        elapsed_ms: Date.now() - startedAt,
        degrade_reason: normalizedOutput.degradeReason,
        hits: normalizedOutput.hits.slice(0, input.perLaneLimit)
      };
    } catch (error) {
      const degradeReason =
        error instanceof LaneTimeoutError
          ? `${lane}_timeout`
          : `${lane}_error:${error instanceof Error ? error.message : String(error)}`;
      return {
        lane,
        status: "degraded",
        timeout_ms: timeoutMs,
        elapsed_ms: Date.now() - startedAt,
        degrade_reason: degradeReason,
        hits: []
      };
    }
  }

  private runLexicalLane(
    query: string,
    contexts: RagRetrievalEntryContext[],
    limit: number
  ): RagRetrievalLaneHit[] {
    const tokens = this.extractTokens(query);
    const hits: RagRetrievalLaneHit[] = [];
    for (const context of contexts) {
      const searchable = context.entry.lexicalContent.toLowerCase();
      const evidence: string[] = [];
      let tokenMatchScore = 0;
      for (const token of tokens) {
        if (searchable.includes(token)) {
          tokenMatchScore += 1;
          evidence.push(`token:${token}`);
        }
      }
      if (tokenMatchScore <= 0) {
        continue;
      }

      const tableHit = context.parsedMetadata.tableNames.filter((tableName) =>
        searchable.includes(tableName.toLowerCase())
      );
      const columnHit = context.parsedMetadata.columnNames.filter((columnName) =>
        searchable.includes(columnName.toLowerCase())
      );
      for (const tableName of tableHit) {
        evidence.push(`table:${tableName}`);
      }
      for (const columnName of columnHit) {
        evidence.push(`column:${columnName}`);
      }

      const score =
        tokenMatchScore * 1.0 + tableHit.length * 0.4 + columnHit.length * 0.2;
      hits.push({
        lane: "lexical",
        chunk_id: context.entry.chunkId,
        score,
        evidence: this.unique(evidence),
        chunk: this.toChunkPayload(context)
      });
    }
    return this.sortHits(hits).slice(0, limit);
  }

  private runDenseLane(
    query: string,
    contexts: RagRetrievalEntryContext[],
    limit: number
  ): RagRetrievalLaneHit[] {
    const queryVector = this.buildDenseVector(query);
    const hits: RagRetrievalLaneHit[] = [];
    for (const context of contexts) {
      const vector = this.parseDenseVector(context.entry.denseVector);
      if (!vector || vector.length === 0 || vector.length !== queryVector.length) {
        continue;
      }
      const cosine = this.cosineSimilarity(queryVector, vector);
      if (!Number.isFinite(cosine) || cosine <= 0) {
        continue;
      }
      hits.push({
        lane: "dense",
        chunk_id: context.entry.chunkId,
        score: Number(cosine.toFixed(12)),
        evidence: [`cosine:${cosine.toFixed(6)}`],
        chunk: this.toChunkPayload(context)
      });
    }
    return this.sortHits(hits).slice(0, limit);
  }

  private async runGraphLane(
    query: string,
    contexts: RagRetrievalEntryContext[],
    limit: number
  ): Promise<LaneExecutionOutput> {
    return this.graphService.runLane({
      query,
      contexts,
      limit,
      fallbackRunner: () => this.runGraphLaneHeuristic(query, contexts, limit)
    });
  }

  private runGraphLaneHeuristic(
    query: string,
    contexts: RagRetrievalEntryContext[],
    limit: number
  ): RagRetrievalLaneHit[] {
    const tokens = this.extractTokens(query);
    const hits: RagRetrievalLaneHit[] = [];
    for (const context of contexts) {
      const evidence: string[] = [];
      let score = 0;

      if (context.entry.domain === "semantic_term") {
        score += 0.6;
        evidence.push("domain:semantic_term");
      }
      if (context.entry.domain === "schema") {
        score += 0.2;
        evidence.push("domain:schema");
      }

      for (const tableName of context.parsedMetadata.tableNames) {
        const normalizedTable = tableName.toLowerCase();
        if (tokens.some((token) => normalizedTable.includes(token) || token.includes(normalizedTable))) {
          score += 0.8;
          evidence.push(`table:${tableName}`);
        }
      }
      for (const columnName of context.parsedMetadata.columnNames) {
        const normalizedColumn = columnName.toLowerCase();
        if (
          tokens.some((token) => normalizedColumn.includes(token) || token.includes(normalizedColumn))
        ) {
          score += 0.5;
          evidence.push(`column:${columnName}`);
        }
      }

      if (/\b(join|relationship|foreign|关联|外键)\b/i.test(query) && context.entry.domain === "schema") {
        score += 0.4;
        evidence.push("graph:relationship_hint");
      }

      if (score <= 0) {
        continue;
      }
      hits.push({
        lane: "graph",
        chunk_id: context.entry.chunkId,
        score: Number(score.toFixed(12)),
        evidence: this.unique(evidence),
        chunk: this.toChunkPayload(context)
      });
    }
    return this.sortHits(hits).slice(0, limit);
  }

  private normalizeLaneOutput(output: LaneExecutionOutput): {
    hits: RagRetrievalLaneHit[];
    degradeReason?: string;
  } {
    if (Array.isArray(output)) {
      return {
        hits: output
      };
    }
    return {
      hits: output.hits,
      degradeReason: output.degradeReason
    };
  }

  private toEntryContext(
    indexVersionId: string,
    entry: RagRetrievalEntryContext["entry"]
  ): RagRetrievalEntryContext {
    const parsed = this.safeParseJson(entry.metadata);
    const sourceMetadata = this.isRecord(parsed.sourceMetadata)
      ? parsed.sourceMetadata
      : {};
    const tableNames = this.readStringArray(parsed.tableNames).length
      ? this.readStringArray(parsed.tableNames)
      : this.readStringArray(sourceMetadata.tableNames);
    const columnNames = this.readStringArray(parsed.columnNames).length
      ? this.readStringArray(parsed.columnNames)
      : this.readStringArray(sourceMetadata.columnNames);

    return {
      indexVersionId,
      entry,
      parsedMetadata: {
        ...parsed,
        sourceMetadata,
        tableNames,
        columnNames,
        chunkProfile:
          this.readString(parsed.chunkProfile) ??
          this.readString(sourceMetadata.chunkProfile),
        startOffset: this.readNumber(parsed.startOffset) ?? this.readNumber(sourceMetadata.startOffset),
        endOffset: this.readNumber(parsed.endOffset) ?? this.readNumber(sourceMetadata.endOffset)
      }
    };
  }

  private toChunkPayload(context: RagRetrievalEntryContext): RagRetrievalChunkPayload {
    const metadata: RagRetrievalChunkMetadata = {
      datasourceId: context.entry.datasourceId,
      indexVersionId: context.indexVersionId,
      chunkId: context.entry.chunkId,
      domain: context.entry.domain,
      chunkProfile: this.readString(context.parsedMetadata.chunkProfile),
      startOffset: this.readNumber(context.parsedMetadata.startOffset),
      endOffset: this.readNumber(context.parsedMetadata.endOffset),
      tableNames: this.readStringArray(context.parsedMetadata.tableNames),
      columnNames: this.readStringArray(context.parsedMetadata.columnNames),
      sourceMetadata: this.isRecord(context.parsedMetadata.sourceMetadata)
        ? context.parsedMetadata.sourceMetadata
        : {}
    };

    return {
      chunk_id: context.entry.chunkId,
      content: context.entry.lexicalContent,
      metadata
    };
  }

  private applyDomainCoverage(
    candidates: RagRetrievalCandidate[],
    limit: number,
    requiredDomains: string[]
  ): RagRetrievalCandidate[] {
    const selected: RagRetrievalCandidate[] = [];
    const byId = new Set<string>();
    for (const candidate of candidates) {
      if (selected.length >= limit) {
        break;
      }
      selected.push(candidate);
      byId.add(candidate.chunk_id);
    }

    const selectedDomains = new Set(
      selected.map((candidate) => candidate.chunk.metadata.domain)
    );
    for (const domain of requiredDomains) {
      if (selected.length >= limit || selectedDomains.has(domain)) {
        continue;
      }
      const fallback = candidates.find(
        (candidate) =>
          candidate.chunk.metadata.domain === domain && !byId.has(candidate.chunk_id)
      );
      if (!fallback) {
        continue;
      }
      selected.push(fallback);
      byId.add(fallback.chunk_id);
      selectedDomains.add(domain);
    }
    return selected.slice(0, limit);
  }

  private createEmptyLaneResults(
    laneTimeoutMs: Record<RagRetrievalLane, number>,
    degradeReason: string
  ): Record<RagRetrievalLane, RagRetrievalLaneResult> {
    return {
      lexical: {
        lane: "lexical",
        status: "degraded",
        timeout_ms: laneTimeoutMs.lexical,
        elapsed_ms: 0,
        degrade_reason: degradeReason,
        hits: []
      },
      dense: {
        lane: "dense",
        status: "degraded",
        timeout_ms: laneTimeoutMs.dense,
        elapsed_ms: 0,
        degrade_reason: degradeReason,
        hits: []
      },
      graph: {
        lane: "graph",
        status: "degraded",
        timeout_ms: laneTimeoutMs.graph,
        elapsed_ms: 0,
        degrade_reason: degradeReason,
        hits: []
      }
    };
  }

  private collectDegradeReasons(
    laneResults: Record<RagRetrievalLane, RagRetrievalLaneResult>
  ): string[] {
    const degradeReasons: string[] = [];
    for (const lane of RAG_RETRIEVAL_LANES) {
      const laneResult = laneResults[lane];
      if (laneResult.status === "degraded" && laneResult.degrade_reason) {
        degradeReasons.push(laneResult.degrade_reason);
      }
    }
    return degradeReasons;
  }

  private collectSemanticLinkageDegradeReasons(
    candidates: RagRetrievalCandidate[]
  ): string[] {
    const reasons: string[] = [];
    for (const candidate of candidates) {
      if (candidate.chunk.metadata.domain !== "semantic_term") {
        continue;
      }
      const sourceMetadata = candidate.chunk.metadata.sourceMetadata;
      const linkageStatus =
        this.isRecord(sourceMetadata) && typeof sourceMetadata.linkageStatus === "string"
          ? sourceMetadata.linkageStatus.trim().toLowerCase()
          : undefined;
      if (linkageStatus !== "degraded") {
        continue;
      }
      const degradeReason =
        this.isRecord(sourceMetadata) && typeof sourceMetadata.linkageDegradeReason === "string"
          ? sourceMetadata.linkageDegradeReason.trim()
          : undefined;
      reasons.push(degradeReason || SEMANTIC_PROMOTED_DEGRADED_REASON);
    }
    return reasons;
  }

  private decorateSemanticCandidates(
    candidates: RagRetrievalCandidate[]
  ): RagRetrievalCandidate[] {
    return candidates.map((candidate) => {
      const semanticHitClues = this.readSemanticHitClues(candidate.chunk.metadata.sourceMetadata);
      if (semanticHitClues.length === 0) {
        return candidate;
      }
      return {
        ...candidate,
        evidence: this.unique([...candidate.evidence, ...semanticHitClues])
      };
    });
  }

  private resolveLaneTimeoutMs(
    input: RagRetrievalRequest
  ): Record<RagRetrievalLane, number> {
    return {
      lexical: this.normalizeTimeout(input.laneTimeoutMs?.lexical, DEFAULT_LANE_TIMEOUT_MS.lexical),
      dense: this.normalizeTimeout(input.laneTimeoutMs?.dense, DEFAULT_LANE_TIMEOUT_MS.dense),
      graph: this.normalizeTimeout(input.laneTimeoutMs?.graph, DEFAULT_LANE_TIMEOUT_MS.graph)
    };
  }

  private normalizeLimit(raw: number | undefined, fallback: number): number {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.floor(raw);
  }

  private normalizeTimeout(raw: number | undefined, fallback: number): number {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.floor(raw);
  }

  private extractTokens(query: string): string[] {
    const tokens = query
      .toLowerCase()
      .match(/[a-z0-9_\p{L}\p{N}]+/gu);
    if (!tokens) {
      return [];
    }
    return this.unique(
      tokens.map((token) => token.trim()).filter((token) => token.length > 0)
    );
  }

  private parseDenseVector(value?: string): number[] | undefined {
    if (!value) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) {
        return undefined;
      }
      const vector = parsed
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
      return vector.length > 0 ? vector : undefined;
    } catch {
      return undefined;
    }
  }

  private buildDenseVector(input: string): number[] {
    const digest = createHash("sha256").update(input).digest();
    const dimensions = 8;
    return Array.from({ length: dimensions }, (_, index) => {
      const byte = digest[index] ?? 0;
      const normalized = byte / 255;
      return Number((normalized * 2 - 1).toFixed(6));
    });
  }

  private cosineSimilarity(left: number[], right: number[]): number {
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
      const l = left[index] ?? 0;
      const r = right[index] ?? 0;
      dot += l * r;
      leftNorm += l * l;
      rightNorm += r * r;
    }
    if (leftNorm <= 0 || rightNorm <= 0) {
      return 0;
    }
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  private sortHits(hits: RagRetrievalLaneHit[]): RagRetrievalLaneHit[] {
    return [...hits].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.chunk_id.localeCompare(right.chunk_id);
    });
  }

  private timeout(timeoutMs: number, lane: RagRetrievalLane): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new LaneTimeoutError(lane)), timeoutMs);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values));
  }

  private async buildContextPack(input: {
    bundle?: RagRetrievalResponse["retrieval_bundle"];
    workspaceId?: string;
    datasourceId: string;
    status: "ready" | "degraded";
    degradeReasons: string[];
  }): Promise<RagContextPack> {
    const bundle = input.bundle;
    const activeModeling = await this.resolveActiveModelingSnapshot(
      input.workspaceId,
      input.datasourceId
    );
    const semanticCandidates =
      bundle?.candidates.filter((candidate) => candidate.chunk.metadata.domain === "semantic_term") ??
      [];
    const retrievalModelKeys = this.unique(
      semanticCandidates.flatMap((candidate) => candidate.chunk.metadata.tableNames)
    );
    const modelKeys = this.unique([
      ...activeModeling.modelKeys,
      ...retrievalModelKeys
    ]);
    const relationshipKeys = this.unique(activeModeling.relationshipKeys);
    const calculatedFieldKeys = this.unique(activeModeling.calculatedFieldKeys);
    const metricKeys = this.unique(
      bundle?.skill_context?.context.map((entry) => entry.term) ?? []
    );
    const selectedContext = bundle?.selected_context ?? [];
    const modelingRevision = activeModeling.modelingRevision;
    const semanticBindings = {
      model_keys: modelKeys,
      relationship_keys: relationshipKeys,
      metric_keys: metricKeys,
      calculated_field_keys: calculatedFieldKeys,
      modelKeys,
      relationshipKeys,
      metricKeys,
      calculatedFieldKeys
    };
    const instructionSets = {
      model_bindings: modelKeys,
      relationship_bindings: relationshipKeys,
      metric_bindings: metricKeys,
      calculated_field_bindings: calculatedFieldKeys,
      modelBindings: modelKeys,
      relationshipBindings: relationshipKeys,
      metricBindings: metricKeys,
      calculatedFieldBindings: calculatedFieldKeys
    };
    const selectedContextSummary = {
      count: selectedContext.length,
      snippets: selectedContext.map((entry) => entry.content.slice(0, 160)).slice(0, 5),
      selectedContextCount: selectedContext.length
    };
    const degradeReasons = this.unique(input.degradeReasons);
    const riskTags = this.unique([
      ...(input.status === "degraded"
        ? ["semantic_spine_degraded", ...(bundle?.risk_tags ?? [])]
        : bundle?.risk_tags ?? []),
      ...(input.workspaceId && modelingRevision === undefined
        ? [MODELING_REVISION_MISSING_RISK_TAG]
        : [])
    ]);

    return {
      status: input.status,
      modeling_revision: modelingRevision,
      modelingRevision,
      semantic_lock_status: input.status === "ready" ? "locked" : "degraded",
      semanticLockStatus: input.status === "ready" ? "locked" : "degraded",
      semantic_bindings: semanticBindings,
      semanticBindings,
      instruction_sets: instructionSets,
      instructionSets,
      selected_context_summary: selectedContextSummary,
      selectedContextSummary,
      degrade_reasons: degradeReasons,
      degradeReasons,
      risk_tags: riskTags,
      riskTags
    };
  }

  private async resolveActiveModelingSnapshot(
    workspaceIdRaw: string | undefined,
    datasourceIdRaw: string
  ): Promise<{
    modelingRevision?: number;
    modelKeys: string[];
    relationshipKeys: string[];
    calculatedFieldKeys: string[];
  }> {
    const workspaceId = workspaceIdRaw?.trim();
    const datasourceId = datasourceIdRaw.trim();
    if (!workspaceId || !datasourceId) {
      return {
        modelKeys: [],
        relationshipKeys: [],
        calculatedFieldKeys: []
      };
    }
    const scope = await this.modelingGraphRepository.getLatestScopeState({
      workspaceId,
      datasourceId
    });
    if (!scope.activeRevision) {
      return {
        modelKeys: [],
        relationshipKeys: [],
        calculatedFieldKeys: []
      };
    }
    const activeRevision = await this.modelingGraphRepository.findRevision({
      workspaceId,
      datasourceId,
      revision: scope.activeRevision
    });
    if (!activeRevision) {
      return {
        modelingRevision: scope.activeRevision,
        modelKeys: [],
        relationshipKeys: [],
        calculatedFieldKeys: []
      };
    }

    const modelKeys = this.unique(
      (activeRevision.graphPayload.models ?? [])
        .map((model) => this.readString(model.modelName ?? model.id ?? model.tableName))
        .filter((model): model is string => Boolean(model))
    );
    const relationshipKeys = this.unique(
      (activeRevision.graphPayload.relationships ?? [])
        .map((relationship) =>
          this.readString(relationship.id ?? relationship.name)
        )
        .filter((relationship): relationship is string => Boolean(relationship))
    );
    const calculatedFieldKeys = this.unique(
      (activeRevision.graphPayload.calculatedFields ?? [])
        .map((field) => this.readString(field.id ?? field.name))
        .filter((field): field is string => Boolean(field))
    );

    return {
      modelingRevision: scope.activeRevision,
      modelKeys,
      relationshipKeys,
      calculatedFieldKeys
    };
  }

  private safeParseJson(value?: string): Record<string, unknown> {
    if (!value || !value.trim()) {
      return {};
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (this.isRecord(parsed)) {
        return parsed;
      }
      return {};
    } catch {
      return {};
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return this.unique(
      value
        .map((item) => this.readString(item))
        .filter((item): item is string => Boolean(item))
    );
  }

  private readSemanticHitClues(value: unknown): string[] {
    if (!this.isRecord(value)) {
      return [];
    }
    return this.readStringArray(value.semanticHitClues).map((clue) => {
      if (clue.includes(":")) {
        return clue;
      }
      return `semantic_hit:${clue}`;
    });
  }

  private async persistReplay(bundle: RagRetrievalResponse["retrieval_bundle"]): Promise<void> {
    for (const lane of RAG_RETRIEVAL_LANES) {
      const laneResult = bundle.lane_results[lane];
      await this.replayRepository.writeReplay({
        runId: bundle.run_id,
        replayKey: `retrieval:lane:${lane}`,
        datasourceId: bundle.datasource_id,
        stage: "retrieval_lane",
        indexVersionId: bundle.index_version_id,
        payload: {
          lane,
          status: laneResult.status,
          timeoutMs: laneResult.timeout_ms,
          elapsedMs: laneResult.elapsed_ms,
          degradeReason: laneResult.degrade_reason,
          hits: laneResult.hits.map((item) => ({
            chunkId: item.chunk_id,
            score: item.score,
            evidence: item.evidence
          }))
        }
      });
    }

    await this.replayRepository.writeReplay({
      runId: bundle.run_id,
      replayKey: "retrieval:fused",
      datasourceId: bundle.datasource_id,
      stage: "retrieval_fused",
      indexVersionId: bundle.index_version_id,
      payload: {
        status: bundle.status,
        degradeReasons: bundle.degrade_reasons,
        decisionReasons: bundle.decision_reasons ?? [],
        candidateCount: bundle.candidates.length,
        skillContext: bundle.skill_context,
        candidates: bundle.candidates.map((candidate) => ({
          chunkId: candidate.chunk_id,
          sourceLane: candidate.source_lane,
          score: candidate.score,
          domain: candidate.chunk.metadata.domain
        }))
      }
    });
  }

  private async writeBudgetReplay(input: {
    runId: string;
    datasourceId: string;
    indexVersionId: string;
    decisionReasons: string[];
    perLaneLimit: number;
    finalCandidateLimit: number;
    enabledLanes: RagRetrievalLane[];
  }): Promise<void> {
    await this.replayRepository.writeReplay({
      runId: input.runId,
      replayKey: "retrieval:budget",
      datasourceId: input.datasourceId,
      stage: "retrieval_budget",
      indexVersionId: input.indexVersionId,
      payload: {
        decisionReasons: input.decisionReasons,
        perLaneLimit: input.perLaneLimit,
        finalCandidateLimit: input.finalCandidateLimit,
        enabledLanes: input.enabledLanes
      }
    });
  }

  private async resolveSkillContext(
    query: string,
    candidates: RagRetrievalCandidate[]
  ): Promise<RagSkillContext> {
    if (candidates.length === 0) {
      return {
        skills: [],
        context: []
      };
    }
    const firstCandidate = candidates.find(
      (candidate) => candidate.chunk.metadata.domain === "semantic_term"
    ) ?? candidates[0];
    const domain = firstCandidate?.chunk.metadata.domain ?? "semantic_term";
    const tableNames = this.unique(
      candidates.flatMap((candidate) => candidate.chunk.metadata.tableNames).slice(0, 30)
    );
    const columnNames = this.unique(
      candidates.flatMap((candidate) => candidate.chunk.metadata.columnNames).slice(0, 30)
    );

    try {
      return await this.skillRegistry.resolveSkills({
        domain,
        term: query,
        context: {
          query,
          tableNames,
          columnNames,
          candidateCount: candidates.length
        }
      });
    } catch {
      return {
        skills: [],
        context: [],
        degrade_reason: SKILL_REGISTRY_UNAVAILABLE_REASON
      };
    }
  }
}
