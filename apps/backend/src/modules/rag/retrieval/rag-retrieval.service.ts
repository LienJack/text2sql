import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { GraphService } from "../../knowledge/graph/graph.service";
import {
  SKILL_REGISTRY_UNAVAILABLE_REASON,
  SkillRegistryService
} from "../../skill-registry/skill-registry.service";
import { RagIndexRepository } from "../index/rag-index.repository";
import { RagReplayRepository } from "../observability/rag-replay.repository";
import { RagBudgetPolicy } from "../perf/rag-budget-policy";
import { RagCacheKeyFactory } from "../perf/rag-cache-key.factory";
import { RagQueryCacheService } from "../perf/rag-query-cache.service";
import { RagQualityService } from "../quality/rag-quality.service";
import { ModelingGraphRepository } from "../../platform/data/persistence/modeling-graph.repository";
import { fuseWithRrf } from "./fusion/rrf-fusion";
import {
  RAG_RETRIEVAL_LANES,
  type RagPriorSqlLaneEvidence,
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
} from "./rag-retrieval.types";

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

interface PriorSqlSelectionResult {
  lane: RagPriorSqlLaneEvidence;
  selectedCandidates: RagRetrievalCandidate[];
  blockedChunkIds: Set<string>;
}

interface ColumnPruningTableDecision {
  table_name: string;
  mode: "none" | "light" | "conservative";
  evidence_strength: "weak" | "medium" | "strong";
  total_columns: number;
  kept_columns: string[];
  pruned_columns: string[];
  reason_codes: string[];
}

interface ColumnPruningEvidence {
  strategy: "table_first_field_second_conservative";
  status: "applied" | "skipped";
  query_tokens: string[];
  affected_candidate_count: number;
  tables: ColumnPruningTableDecision[];
  reason_codes: string[];
}

interface ColumnPruningResult {
  candidates: RagRetrievalCandidate[];
  evidence?: ColumnPruningEvidence;
}

interface WideTableProfile {
  tableName: string;
  normalizedTableName: string;
  columns: string[];
}

interface TablePruningPlan {
  tableName: string;
  normalizedTableName: string;
  keepColumns: Set<string>;
  decision: ColumnPruningTableDecision;
}

const WIDE_TABLE_COLUMN_THRESHOLD = 8;
const LIGHT_PRUNING_KEEP_RATIO = 0.7;
const CONSERVATIVE_PRUNING_MAX_KEEP = 6;
const MIN_COLUMN_KEEP_COUNT = 3;
const COLUMN_HINT_PREFIX = "column:";

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
    const workspaceId = input.workspaceId?.trim() || undefined;
    const allowedTables = this.normalizeAllowedTables(input.allowedTables);
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
            workspaceId,
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
            workspaceId,
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
    const budgetLaneProfile = this.buildBudgetLaneProfile({
      enabledLanes: budgetDecision.enabledLanes,
      workspaceId,
      allowedTables
    });
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
        workspaceId,
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
    const priorSqlSelection = this.selectTrustedPriorSqlCandidates({
      candidates: fused,
      datasourceId,
      workspaceId,
      allowedTables
    });
    const priorSqlFiltered = this.filterBlockedPriorSqlCandidates(
      fused,
      priorSqlSelection.blockedChunkIds
    );
    const fusedWithPrior = this.injectTrustedPriorSqlCandidates(
      priorSqlFiltered,
      priorSqlSelection.selectedCandidates
    );
    const coveredCandidates = this.applyDomainCoverage(
      fusedWithPrior,
      finalCandidateLimit,
      REQUIRED_DOMAIN_COVERAGE
    );
    const decoratedCandidates = this.decorateSemanticCandidates(coveredCandidates);
    const columnPruning = this.applyConservativeColumnPruning({
      query,
      candidates: decoratedCandidates
    });
    const candidates = columnPruning.candidates;
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
        prior_sql_lane: priorSqlSelection.lane,
        priorSqlLane: priorSqlSelection.lane,
        decision_reasons: budgetDecision.decisionReasons
      }
    };
    this.attachColumnPruningEvidence(response.retrieval_bundle, columnPruning.evidence);
    response.retrieval_bundle.context_pack = await this.buildContextPack({
      bundle: response.retrieval_bundle,
      workspaceId,
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
    const priorSqlLane = this.readPriorSqlLaneEvidence(input.cachedBundle);
    const columnPruning = this.readColumnPruningEvidence(input.cachedBundle);
    const hydratedBundle: RagRetrievalResponse["retrieval_bundle"] = {
      ...input.cachedBundle,
      query: input.query,
      datasource_id: input.datasourceId,
      run_id: input.runId,
      prior_sql_lane: priorSqlLane,
      priorSqlLane: priorSqlLane,
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
    this.attachColumnPruningEvidence(hydratedBundle, columnPruning);
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

  private buildBudgetLaneProfile(input: {
    enabledLanes: RagRetrievalLane[];
    workspaceId?: string;
    allowedTables: string[];
  }): string {
    const workspacePart = input.workspaceId?.trim().toLowerCase() || "none";
    const tableDigest = createHash("sha256")
      .update(input.allowedTables.join("|"))
      .digest("hex")
      .slice(0, 12);
    return `${input.enabledLanes.join("+")}::ws:${workspacePart}::tables:${tableDigest}`;
  }

  private normalizeAllowedTables(raw: string[] | undefined): string[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      return [];
    }
    return this.unique(
      raw
        .map((tableName) => this.readString(tableName))
        .filter((tableName): tableName is string => Boolean(tableName))
        .map((tableName) => tableName.toLowerCase())
    ).sort();
  }

  private selectTrustedPriorSqlCandidates(input: {
    candidates: RagRetrievalCandidate[];
    datasourceId: string;
    workspaceId?: string;
    allowedTables: string[];
  }): PriorSqlSelectionResult {
    const trustedSqlExampleCandidates = input.candidates.filter(
      (candidate) =>
        candidate.chunk.metadata.domain === "sql_example" &&
        this.isTrustedPriorSqlCandidate(candidate)
    );
    const selectedCandidates: RagRetrievalCandidate[] = [];
    const blockedChunkIds = new Set<string>();
    const degradeReasons: string[] = [];
    const allowedTables = new Set(input.allowedTables);
    const workspaceId = input.workspaceId?.trim();

    for (const candidate of trustedSqlExampleCandidates) {
      const filterReasons = this.collectPriorSqlFilterReasons({
        candidate,
        datasourceId: input.datasourceId,
        workspaceId,
        allowedTables
      });
      if (filterReasons.length > 0) {
        blockedChunkIds.add(candidate.chunk_id);
        degradeReasons.push(...filterReasons);
        continue;
      }
      selectedCandidates.push({
        ...candidate,
        evidence: this.unique([...candidate.evidence, "prior_sql:trusted"])
      });
    }

    if (selectedCandidates.length > 0) {
      const lane: RagPriorSqlLaneEvidence = {
        status: "hit",
        matched_count: trustedSqlExampleCandidates.length,
        selected_count: selectedCandidates.length,
        filtered_count: blockedChunkIds.size,
        ...(degradeReasons.length > 0
          ? {
              degrade_reasons: this.unique(degradeReasons)
            }
          : {})
      };
      return {
        lane: this.withPriorSqlLaneCompatFields(lane),
        selectedCandidates,
        blockedChunkIds
      };
    }

    const lane: RagPriorSqlLaneEvidence = {
      status: trustedSqlExampleCandidates.length > 0 ? "filtered" : "miss",
      matched_count: trustedSqlExampleCandidates.length,
      selected_count: 0,
      filtered_count: blockedChunkIds.size,
      degrade_reasons:
        trustedSqlExampleCandidates.length > 0
          ? this.unique(degradeReasons)
          : ["prior_sql_no_trusted_match"]
    };
    return {
      lane: this.withPriorSqlLaneCompatFields(lane),
      selectedCandidates: [],
      blockedChunkIds
    };
  }

  private isTrustedPriorSqlCandidate(candidate: RagRetrievalCandidate): boolean {
    const sourceMetadata = candidate.chunk.metadata.sourceMetadata;
    if (!this.isRecord(sourceMetadata)) {
      return false;
    }
    return (
      this.readBooleanFlag(sourceMetadata.trusted) ||
      this.readBooleanFlag(sourceMetadata.verified) ||
      this.readBooleanFlag(sourceMetadata.priorSql) ||
      this.readBooleanFlag(sourceMetadata.prior_sql)
    );
  }

  private readBooleanFlag(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0;
    }
    if (typeof value !== "string") {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }

  private collectPriorSqlFilterReasons(input: {
    candidate: RagRetrievalCandidate;
    datasourceId: string;
    workspaceId?: string;
    allowedTables: Set<string>;
  }): string[] {
    const reasons: string[] = [];
    const normalizedDatasourceId = input.datasourceId.trim().toLowerCase();
    if (input.candidate.chunk.metadata.datasourceId.trim().toLowerCase() !== normalizedDatasourceId) {
      reasons.push("prior_sql_filtered_datasource_mismatch");
    }

    const sourceMetadata = input.candidate.chunk.metadata.sourceMetadata;
    const metadataWorkspaceId = this.readWorkspaceIdFromSourceMetadata(sourceMetadata);
    if (metadataWorkspaceId && metadataWorkspaceId !== (input.workspaceId?.trim() || "")) {
      reasons.push("prior_sql_filtered_workspace_mismatch");
    }

    if (input.allowedTables.size > 0) {
      const tableNames = input.candidate.chunk.metadata.tableNames.map((tableName) =>
        tableName.trim().toLowerCase()
      );
      const isAllowedSubset = tableNames.every((tableName) => input.allowedTables.has(tableName));
      if (!isAllowedSubset) {
        reasons.push("prior_sql_filtered_not_in_allowed_tables");
      }
    }
    return reasons;
  }

  private readWorkspaceIdFromSourceMetadata(sourceMetadata: unknown): string | undefined {
    if (!this.isRecord(sourceMetadata)) {
      return undefined;
    }
    return this.readString(sourceMetadata.workspaceId) ?? this.readString(sourceMetadata.workspace_id);
  }

  private filterBlockedPriorSqlCandidates(
    candidates: RagRetrievalCandidate[],
    blockedChunkIds: Set<string>
  ): RagRetrievalCandidate[] {
    if (blockedChunkIds.size === 0) {
      return candidates;
    }
    return candidates.filter((candidate) => !blockedChunkIds.has(candidate.chunk_id));
  }

  private injectTrustedPriorSqlCandidates(
    candidates: RagRetrievalCandidate[],
    trustedCandidates: RagRetrievalCandidate[]
  ): RagRetrievalCandidate[] {
    if (trustedCandidates.length === 0) {
      return candidates;
    }
    const trustedByChunkId = new Map(
      trustedCandidates.map((candidate) => [candidate.chunk_id, candidate])
    );
    const promoted: RagRetrievalCandidate[] = [];
    const seen = new Set<string>();
    for (const candidate of trustedCandidates) {
      if (!seen.has(candidate.chunk_id)) {
        promoted.push(candidate);
        seen.add(candidate.chunk_id);
      }
    }
    for (const candidate of candidates) {
      if (seen.has(candidate.chunk_id)) {
        continue;
      }
      promoted.push(trustedByChunkId.get(candidate.chunk_id) ?? candidate);
      seen.add(candidate.chunk_id);
    }
    return promoted;
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

  private applyConservativeColumnPruning(input: {
    query: string;
    candidates: RagRetrievalCandidate[];
  }): ColumnPruningResult {
    if (input.candidates.length === 0) {
      return {
        candidates: input.candidates
      };
    }
    const queryTokens = this.extractTokens(input.query);
    const wideTableProfiles = this.collectWideTableProfiles(input.candidates);
    if (wideTableProfiles.length === 0) {
      return {
        candidates: input.candidates
      };
    }

    const tablePlans = wideTableProfiles.map((profile) =>
      this.buildTablePruningPlan({
        profile,
        queryTokens,
        candidates: input.candidates
      })
    );
    const planByTable = new Map(
      tablePlans.map((plan) => [plan.normalizedTableName, plan])
    );
    let affectedCandidateCount = 0;
    const candidates = input.candidates.map((candidate) => {
      const candidateTableNames = candidate.chunk.metadata.tableNames
        .map((tableName) => tableName.trim().toLowerCase())
        .filter((tableName) => tableName.length > 0);
      const keepColumns = new Set<string>();
      for (const tableName of candidateTableNames) {
        const plan = planByTable.get(tableName);
        if (!plan) {
          continue;
        }
        for (const columnName of plan.keepColumns) {
          keepColumns.add(columnName);
        }
      }
      if (keepColumns.size === 0) {
        return candidate;
      }

      const originalColumns = candidate.chunk.metadata.columnNames;
      if (originalColumns.length === 0) {
        return candidate;
      }
      const nextColumns = originalColumns.filter((columnName) =>
        keepColumns.has(columnName.trim().toLowerCase())
      );
      if (nextColumns.length === 0 || nextColumns.length === originalColumns.length) {
        return candidate;
      }
      affectedCandidateCount += 1;
      return {
        ...candidate,
        chunk: {
          ...candidate.chunk,
          metadata: {
            ...candidate.chunk.metadata,
            columnNames: nextColumns
          }
        }
      };
    });

    const reasonCodes = this.unique(
      tablePlans.flatMap((plan) => plan.decision.reason_codes)
    );
    const evidence: ColumnPruningEvidence = {
      strategy: "table_first_field_second_conservative",
      status: affectedCandidateCount > 0 ? "applied" : "skipped",
      query_tokens: queryTokens,
      affected_candidate_count: affectedCandidateCount,
      tables: tablePlans.map((plan) => plan.decision),
      reason_codes: reasonCodes
    };
    return {
      candidates,
      evidence
    };
  }

  private collectWideTableProfiles(candidates: RagRetrievalCandidate[]): WideTableProfile[] {
    const profileByTable = new Map<
      string,
      {
        tableName: string;
        columnOrder: string[];
        seenColumns: Set<string>;
      }
    >();
    for (const candidate of candidates) {
      const tableNames = candidate.chunk.metadata.tableNames;
      const columns = candidate.chunk.metadata.columnNames;
      if (tableNames.length === 0 || columns.length === 0) {
        continue;
      }
      for (const tableName of tableNames) {
        const normalizedTableName = tableName.trim().toLowerCase();
        if (!normalizedTableName) {
          continue;
        }
        const existing = profileByTable.get(normalizedTableName) ?? {
          tableName,
          columnOrder: [],
          seenColumns: new Set<string>()
        };
        for (const columnName of columns) {
          const normalizedColumnName = columnName.trim().toLowerCase();
          if (!normalizedColumnName || existing.seenColumns.has(normalizedColumnName)) {
            continue;
          }
          existing.seenColumns.add(normalizedColumnName);
          existing.columnOrder.push(columnName);
        }
        profileByTable.set(normalizedTableName, existing);
      }
    }
    return Array.from(profileByTable.entries())
      .filter(([, profile]) => profile.columnOrder.length >= WIDE_TABLE_COLUMN_THRESHOLD)
      .map(([normalizedTableName, profile]) => ({
        tableName: profile.tableName,
        normalizedTableName,
        columns: profile.columnOrder
      }));
  }

  private buildTablePruningPlan(input: {
    profile: WideTableProfile;
    queryTokens: string[];
    candidates: RagRetrievalCandidate[];
  }): TablePruningPlan {
    const fieldIntentTokens = this.buildFieldIntentTokens(
      input.queryTokens,
      input.profile.normalizedTableName
    );
    const scoreByColumn = new Map<string, number>();
    const evidenceByColumn = new Map<string, string[]>();
    const columnHints = this.collectColumnHintsForTable(input.candidates, input.profile.normalizedTableName);
    for (const columnName of input.profile.columns) {
      const normalizedColumnName = columnName.trim().toLowerCase();
      const signalReasons: string[] = [];
      const tokenScore = this.scoreColumnByQueryTokens(normalizedColumnName, fieldIntentTokens);
      if (tokenScore >= 2) {
        signalReasons.push("query_token_strong_match");
      } else if (tokenScore > 0) {
        signalReasons.push("query_token_partial_match");
      }
      const columnHintMatched = columnHints.has(normalizedColumnName) && tokenScore > 0;
      if (columnHintMatched) {
        signalReasons.push("lane_column_evidence");
      }
      const score = tokenScore + (columnHintMatched ? 1 : 0);
      scoreByColumn.set(normalizedColumnName, score);
      evidenceByColumn.set(normalizedColumnName, signalReasons);
    }

    const rankedColumns = [...input.profile.columns].sort((left, right) => {
      const leftScore = scoreByColumn.get(left.trim().toLowerCase()) ?? 0;
      const rightScore = scoreByColumn.get(right.trim().toLowerCase()) ?? 0;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return left.localeCompare(right);
    });
    const strongMatches = rankedColumns.filter(
      (columnName) => (scoreByColumn.get(columnName.trim().toLowerCase()) ?? 0) >= 2
    );
    const weakMatches = rankedColumns.filter(
      (columnName) =>
        (scoreByColumn.get(columnName.trim().toLowerCase()) ?? 0) === 1
    );
    const anchorColumns = input.profile.columns.filter((columnName) =>
      this.isAnchorColumn(columnName.trim().toLowerCase())
    );
    const totalColumns = input.profile.columns.length;

    let mode: ColumnPruningTableDecision["mode"] = "none";
    let evidenceStrength: ColumnPruningTableDecision["evidence_strength"] = "weak";
    let reasonCodes: string[] = ["column_pruning_weak_evidence"];
    let keepTarget = totalColumns;
    if (strongMatches.length > 0) {
      mode = "conservative";
      evidenceStrength = "strong";
      reasonCodes = ["column_pruning_strong_field_evidence"];
      keepTarget = Math.max(
        MIN_COLUMN_KEEP_COUNT,
        Math.min(
          totalColumns,
          Math.max(strongMatches.length + anchorColumns.length, CONSERVATIVE_PRUNING_MAX_KEEP)
        )
      );
    } else if (weakMatches.length > 0) {
      mode = "light";
      evidenceStrength = "medium";
      reasonCodes = ["column_pruning_uncertain_field_evidence"];
      keepTarget = Math.max(
        MIN_COLUMN_KEEP_COUNT,
        Math.min(totalColumns, Math.ceil(totalColumns * LIGHT_PRUNING_KEEP_RATIO))
      );
    }

    const keepColumns = new Set<string>();
    for (const columnName of [...strongMatches, ...weakMatches, ...anchorColumns, ...rankedColumns]) {
      if (keepColumns.size >= keepTarget) {
        break;
      }
      keepColumns.add(columnName.trim().toLowerCase());
    }
    if (keepColumns.size === 0) {
      for (const columnName of input.profile.columns) {
        keepColumns.add(columnName.trim().toLowerCase());
      }
    }

    const keptColumns = input.profile.columns.filter((columnName) =>
      keepColumns.has(columnName.trim().toLowerCase())
    );
    const prunedColumns =
      mode === "none"
        ? []
        : input.profile.columns.filter(
            (columnName) => !keepColumns.has(columnName.trim().toLowerCase())
          );
    const signalReasons = this.unique(
      keptColumns.flatMap((columnName) =>
        evidenceByColumn.get(columnName.trim().toLowerCase()) ?? []
      )
    );
    if (mode !== "none" && signalReasons.length > 0) {
      reasonCodes = this.unique([...reasonCodes, ...signalReasons]);
    }

    return {
      tableName: input.profile.tableName,
      normalizedTableName: input.profile.normalizedTableName,
      keepColumns,
      decision: {
        table_name: input.profile.tableName,
        mode,
        evidence_strength: evidenceStrength,
        total_columns: totalColumns,
        kept_columns: keptColumns,
        pruned_columns: prunedColumns,
        reason_codes: reasonCodes
      }
    };
  }

  private buildFieldIntentTokens(
    queryTokens: string[],
    normalizedTableName: string
  ): string[] {
    const tableTokens = normalizedTableName
      .split(/[_\s]+/g)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const blocked = new Set([normalizedTableName, ...tableTokens]);
    return queryTokens.filter((token) => !blocked.has(token));
  }

  private collectColumnHintsForTable(
    candidates: RagRetrievalCandidate[],
    normalizedTableName: string
  ): Set<string> {
    const hints = new Set<string>();
    for (const candidate of candidates) {
      const belongsToTable = candidate.chunk.metadata.tableNames.some(
        (tableName) => tableName.trim().toLowerCase() === normalizedTableName
      );
      if (!belongsToTable) {
        continue;
      }
      for (const evidence of candidate.evidence) {
        if (!evidence.startsWith(COLUMN_HINT_PREFIX)) {
          continue;
        }
        const rawColumnName = evidence.slice(COLUMN_HINT_PREFIX.length).trim().toLowerCase();
        if (rawColumnName) {
          hints.add(rawColumnName);
        }
      }
    }
    return hints;
  }

  private scoreColumnByQueryTokens(
    normalizedColumnName: string,
    queryTokens: string[]
  ): number {
    if (queryTokens.length === 0) {
      return 0;
    }
    const columnParts = normalizedColumnName.split(/[_\s]+/g).filter((part) => part.length > 0);
    const substantialParts = columnParts.filter((part) => part.length >= 3);
    let score = 0;
    for (const token of queryTokens) {
      if (token === normalizedColumnName || columnParts.includes(token)) {
        score += 2;
        continue;
      }
      if (
        token.length >= 3 &&
        (normalizedColumnName.includes(token) ||
          substantialParts.some((part) => part.includes(token) || token.includes(part)))
      ) {
        score += 1;
      }
    }
    return score;
  }

  private isAnchorColumn(normalizedColumnName: string): boolean {
    if (
      normalizedColumnName === "id" ||
      normalizedColumnName.endsWith("_id") ||
      normalizedColumnName === "created_at" ||
      normalizedColumnName === "updated_at" ||
      normalizedColumnName === "deleted_at"
    ) {
      return true;
    }
    return normalizedColumnName.endsWith("_at");
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

  private attachColumnPruningEvidence(
    bundle: RagRetrievalResponse["retrieval_bundle"],
    evidence: ColumnPruningEvidence | undefined
  ): void {
    const target = bundle as RagRetrievalResponse["retrieval_bundle"] & {
      column_pruning?: ColumnPruningEvidence;
      columnPruning?: ColumnPruningEvidence;
    };
    if (!evidence) {
      delete target.column_pruning;
      delete target.columnPruning;
      return;
    }
    target.column_pruning = evidence;
    target.columnPruning = evidence;
  }

  private readColumnPruningEvidence(
    bundle: RagRetrievalResponse["retrieval_bundle"]
  ): ColumnPruningEvidence | undefined {
    const source = bundle as RagRetrievalResponse["retrieval_bundle"] & {
      column_pruning?: ColumnPruningEvidence;
      columnPruning?: ColumnPruningEvidence;
    };
    return source.column_pruning ?? source.columnPruning;
  }

  private readPriorSqlLaneEvidence(
    bundle: RagRetrievalResponse["retrieval_bundle"]
  ): RagPriorSqlLaneEvidence | undefined {
    const priorSqlLane = bundle.prior_sql_lane ?? bundle.priorSqlLane;
    if (!priorSqlLane) {
      return undefined;
    }
    return this.withPriorSqlLaneCompatFields(priorSqlLane);
  }

  private withPriorSqlLaneCompatFields(
    lane: RagPriorSqlLaneEvidence
  ): RagPriorSqlLaneEvidence {
    const degradeReasons = lane.degrade_reasons ?? lane.degradeReasons;
    return {
      ...lane,
      matched_count: lane.matched_count,
      selected_count: lane.selected_count,
      filtered_count: lane.filtered_count,
      ...(degradeReasons ? { degrade_reasons: degradeReasons } : {}),
      matchedCount: lane.matched_count,
      selectedCount: lane.selected_count,
      filteredCount: lane.filtered_count,
      ...(degradeReasons ? { degradeReasons } : {})
    };
  }

  private async buildContextPack(input: {
    bundle?: RagRetrievalResponse["retrieval_bundle"];
    workspaceId?: string;
    datasourceId: string;
    status: "ready" | "degraded";
    degradeReasons: string[];
  }): Promise<RagContextPack> {
    const bundle = input.bundle;
    const semanticCandidates =
      bundle?.candidates.filter((candidate) => candidate.chunk.metadata.domain === "semantic_term") ??
      [];
    const modelKeys = this.unique(
      semanticCandidates.flatMap((candidate) => candidate.chunk.metadata.tableNames)
    );
    const metricKeys = this.unique(
      bundle?.skill_context?.context.map((entry) => entry.term) ?? []
    );
    const selectedContext = bundle?.selected_context ?? [];
    const modelingRevision = await this.resolveActiveModelingRevision(
      input.workspaceId,
      input.datasourceId
    );

    return {
      status: input.status,
      modeling_revision: modelingRevision,
      semantic_lock_status: input.status === "ready" ? "locked" : "degraded",
      semantic_bindings: {
        model_keys: modelKeys,
        relationship_keys: [],
        metric_keys: metricKeys,
        calculated_field_keys: []
      },
      instruction_sets: {
        model_bindings: modelKeys,
        relationship_bindings: [],
        metric_bindings: metricKeys,
        calculated_field_bindings: []
      },
      selected_context_summary: {
        count: selectedContext.length,
        snippets: selectedContext.map((entry) => entry.content.slice(0, 160)).slice(0, 5)
      },
      degrade_reasons: this.unique(input.degradeReasons),
      risk_tags: this.unique(
        input.status === "degraded"
          ? ["semantic_spine_degraded", ...(bundle?.risk_tags ?? [])]
          : bundle?.risk_tags ?? []
      )
    };
  }

  private async resolveActiveModelingRevision(
    workspaceIdRaw: string | undefined,
    datasourceIdRaw: string
  ): Promise<number | undefined> {
    const workspaceId = workspaceIdRaw?.trim();
    const datasourceId = datasourceIdRaw.trim();
    if (!workspaceId || !datasourceId) {
      return undefined;
    }
    const scope = await this.modelingGraphRepository.getLatestScopeState({
      workspaceId,
      datasourceId
    });
    return scope.activeRevision;
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
        priorSqlLane: this.readPriorSqlLaneEvidence(bundle),
        columnPruning: this.readColumnPruningEvidence(bundle),
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
