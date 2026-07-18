import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../../common/domain-error";
import { EmbeddingRouterService } from "../../../llm/embedding-router.service";
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
  type RagContextPackLaneMetadata,
  type RagContextPackPruningDecision,
  type RagPriorSqlLaneEvidence,
  type RagPriorSqlShortcutDecision,
  type RagRetrievalBundle,
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

interface PermissionFilteringEvidence {
  status: "applied" | "skipped";
  denied_evidence_ids: string[];
  denied_table_names: string[];
  denied_column_names: string[];
  reason_codes: string[];
  kept_candidate_count: number;
  deniedEvidenceIds?: string[];
  deniedTableNames?: string[];
  deniedColumnNames?: string[];
  reasonCodes?: string[];
  keptCandidateCount?: number;
}

interface PermissionFilteringResult {
  candidates: RagRetrievalCandidate[];
  evidence: PermissionFilteringEvidence;
}

interface ContextPermissionFilteringResult {
  contexts: RagRetrievalEntryContext[];
  evidence: PermissionFilteringEvidence;
}

interface TwoPassSchemaRecallEvidence {
  status: "applied" | "skipped";
  selected_table_names: string[];
  table_description_evidence_ids: string[];
  supplemental_evidence_ids: string[];
  supplemental_families: string[];
  reason_codes: string[];
  selectedTableNames?: string[];
  tableDescriptionEvidenceIds?: string[];
  supplementalEvidenceIds?: string[];
  supplementalFamilies?: string[];
  reasonCodes?: string[];
}

interface TwoPassSchemaRecallResult {
  candidates: RagRetrievalCandidate[];
  evidence: TwoPassSchemaRecallEvidence;
  reasonCodes: string[];
}

interface WideTableProfile {
  tableName: string;
  normalizedTableName: string;
  columns: string[];
}

interface DenseVectorMetadata {
  provider?: string;
  model?: string;
  dimensions?: number;
  vectorVersion?: string;
  indexVersion?: string;
  scope?: string;
  assetType?: string;
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
    private readonly embeddingRouter: EmbeddingRouterService,
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

    if (
      input.requiresSqlPolicy &&
      (allowedTables.length === 0 ||
        !input.policyDigest?.trim() ||
        !Number.isInteger(input.policyVersion) ||
        !input.schemaSnapshotDigest?.trim() ||
        !input.allowedColumnsDigest?.trim())
    ) {
      const degradeReasons = ["trusted_sql_grounding_unavailable"];
      return {
        retrieval_bundle: {
          query,
          run_id: runId,
          datasource_id: datasourceId,
          status: "degraded",
          degrade_reasons: degradeReasons,
          lane_results: this.createEmptyLaneResults(
            laneTimeoutMs,
            "trusted_sql_grounding_unavailable"
          ),
          candidates: [],
          selected_context: [],
          permission_filtering: {
            status: "skipped",
            reason_codes: ["trusted_sql_grounding_unavailable"],
            kept_candidate_count: 0
          },
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
      finalCandidateLimit,
      workspaceId,
      allowedTables: [...allowedTables],
      allowedColumnsDigest: input.allowedColumnsDigest,
      policyVersion: input.policyVersion,
      policyDigest: input.policyDigest,
      schemaSnapshotDigest: input.schemaSnapshotDigest,
      semanticVersion: input.semanticVersion,
      modelingRevision: input.modelingRevision,
      valueSketchVersion: input.valueSketchVersion,
      priorSqlVersion: input.priorSqlVersion,
      promptVersion: input.promptVersion
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
    const preRankingPermissionFiltering = this.applyPermissionFilteringToContexts({
      contexts,
      allowedTables
    });
    const laneResults = await this.collectLaneResults({
      query,
      contexts: preRankingPermissionFiltering.contexts,
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
    const activeModelingRevision = await this.resolveActiveModelingRevision(
      workspaceId,
      datasourceId
    );
    const priorSqlSelection = this.selectTrustedPriorSqlCandidates({
      candidates: fused,
      datasourceId,
      workspaceId,
      allowedTables,
      activeModelingRevision
    });
    const priorSqlFiltered = this.filterBlockedPriorSqlCandidates(
      fused,
      priorSqlSelection.blockedChunkIds
    );
    const fusedWithPrior = this.injectTrustedPriorSqlCandidates(
      priorSqlFiltered,
      priorSqlSelection.selectedCandidates
    );
    const schemaRecall = this.applyTwoPassSchemaRecall({
      candidates: fusedWithPrior,
      contexts: preRankingPermissionFiltering.contexts,
      limit: finalCandidateLimit
    });
    const coveredCandidates = this.applyDomainCoverage(
      schemaRecall.candidates,
      finalCandidateLimit,
      REQUIRED_DOMAIN_COVERAGE
    );
    const decoratedCandidates = this.decorateSemanticCandidates(coveredCandidates);
    const columnPruning = this.applyConservativeColumnPruning({
      query,
      candidates: decoratedCandidates
    });
    const permissionFiltering = this.applyPermissionFiltering({
      candidates: columnPruning.candidates,
      allowedTables
    });
    const candidates = permissionFiltering.candidates;
    const combinedPermissionFiltering = this.mergePermissionFilteringEvidence([
      preRankingPermissionFiltering.evidence,
      permissionFiltering.evidence
    ]);
    const skillContext = await this.resolveSkillContext(
      query,
      candidates,
      workspaceId
    );

    const degradeReasons = this.collectDegradeReasons(laneResults);
    degradeReasons.push(...this.collectSemanticLinkageDegradeReasons(candidates));
    degradeReasons.push(...combinedPermissionFiltering.reason_codes);
    degradeReasons.push(...schemaRecall.reasonCodes);
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
    this.attachPermissionFilteringEvidence(
      response.retrieval_bundle,
      combinedPermissionFiltering
    );
    this.attachTwoPassSchemaRecallEvidence(response.retrieval_bundle, schemaRecall.evidence);
    response.retrieval_bundle.context_pack = await this.buildContextPack({
      bundle: response.retrieval_bundle,
      workspaceId,
      datasourceId,
      status: response.retrieval_bundle.status,
      degradeReasons: uniqueDegradeReasons
    });
    const laneMetadata =
      response.retrieval_bundle.context_pack?.lane_metadata ??
      response.retrieval_bundle.context_pack?.laneMetadata;
    const pruningDecisions =
      response.retrieval_bundle.context_pack?.pruning_decisions ??
      response.retrieval_bundle.context_pack?.pruningDecisions;
    if (laneMetadata && laneMetadata.length > 0) {
      response.retrieval_bundle.lane_metadata = laneMetadata;
      response.retrieval_bundle.laneMetadata = laneMetadata;
    }
    if (pruningDecisions && pruningDecisions.length > 0) {
      response.retrieval_bundle.pruning_decisions = pruningDecisions;
      response.retrieval_bundle.pruningDecisions = pruningDecisions;
    }

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
    this.ragQualityService.recordPreparationPlane({
      runId,
      datasourceId,
      manifestFingerprint: this.extractManifestFingerprint(activeVersion.sourceVersion),
      activeIndexVersionId: activeVersion.id,
      familyCounts: this.countCandidateAssetFamilies(candidates),
      permissionFilteredAssetCount: combinedPermissionFiltering.denied_evidence_ids.length,
      selectedAssetCount: candidates.length,
      staleReasons: schemaRecall.reasonCodes.filter((reason) => reason.includes("stale")),
      lifecycleStatus: "retrieved"
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
    const permissionFiltering = this.readPermissionFilteringEvidence(input.cachedBundle);
    const twoPassSchemaRecall = this.readTwoPassSchemaRecallEvidence(input.cachedBundle);
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
    this.attachPermissionFilteringEvidence(hydratedBundle, permissionFiltering);
    this.attachTwoPassSchemaRecallEvidence(hydratedBundle, twoPassSchemaRecall);
    hydratedBundle.context_pack = await this.buildContextPack({
      bundle: hydratedBundle,
      workspaceId: input.workspaceId,
      datasourceId: input.datasourceId,
      status: hydratedBundle.status,
      degradeReasons: hydratedBundle.degrade_reasons
    });
    const laneMetadata =
      hydratedBundle.context_pack?.lane_metadata ?? hydratedBundle.context_pack?.laneMetadata;
    const pruningDecisions =
      hydratedBundle.context_pack?.pruning_decisions ??
      hydratedBundle.context_pack?.pruningDecisions;
    if (laneMetadata && laneMetadata.length > 0) {
      hydratedBundle.lane_metadata = laneMetadata;
      hydratedBundle.laneMetadata = laneMetadata;
    }
    if (pruningDecisions && pruningDecisions.length > 0) {
      hydratedBundle.pruning_decisions = pruningDecisions;
      hydratedBundle.pruningDecisions = pruningDecisions;
    }
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

  private async runDenseLane(
    query: string,
    contexts: RagRetrievalEntryContext[],
    limit: number
  ): Promise<LaneExecutionOutput> {
    if (contexts.length === 0) {
      return {
        hits: []
      };
    }

    let queryVector: number[];
    let queryMetadata: DenseVectorMetadata | undefined;
    try {
      const embeddings = await this.embeddingRouter.embed({
        texts: [query],
        indexVersion: contexts[0]?.indexVersionId,
        scope: "retrieval_query",
        assetType: "query"
      });
      queryVector = embeddings[0]?.vector ?? [];
      queryMetadata = embeddings[0]
        ? this.toDenseVectorMetadata(embeddings[0].metadata)
        : undefined;
    } catch (error) {
      return {
        hits: [],
        degradeReason: this.resolveDenseUnavailableReason(error)
      };
    }

    if (!queryVector || queryVector.length === 0) {
      return {
        hits: [],
        degradeReason: "dense_unavailable_empty_query_vector"
      };
    }

    const hits: RagRetrievalLaneHit[] = [];
    let incompatibleVectorSpaceDetected = false;
    for (const context of contexts) {
      const vector = this.parseDenseVector(context.entry.denseVector);
      if (!vector || vector.length === 0) {
        continue;
      }
      const candidateDenseMetadata = this.readDenseVectorMetadata(context);
      if (
        vector.length !== queryVector.length ||
        !this.isDenseVectorSpaceCompatible({
          queryMetadata,
          candidateMetadata: candidateDenseMetadata,
          indexVersionId: context.indexVersionId
        })
      ) {
        incompatibleVectorSpaceDetected = true;
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
        evidence: this.unique([
          `cosine:${cosine.toFixed(6)}`,
          ...(candidateDenseMetadata?.provider
            ? [`dense_provider:${candidateDenseMetadata.provider}`]
            : []),
          ...(candidateDenseMetadata?.model
            ? [`dense_model:${candidateDenseMetadata.model}`]
            : [])
        ]),
        chunk: this.toChunkPayload(context)
      });
    }
    if (incompatibleVectorSpaceDetected) {
      return {
        hits: [],
        degradeReason: "dense_unavailable_incompatible_vector_space"
      };
    }
    return {
      hits: this.sortHits(hits).slice(0, limit)
    };
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
        endOffset: this.readNumber(parsed.endOffset) ?? this.readNumber(sourceMetadata.endOffset),
        denseMetadata: this.readDenseVectorMetadataFromParsed(parsed, sourceMetadata)
      }
    };
  }

  private toChunkPayload(context: RagRetrievalEntryContext): RagRetrievalChunkPayload {
    const metadata: RagRetrievalChunkMetadata = {
      datasourceId: context.entry.datasourceId,
      indexVersionId: context.indexVersionId,
      chunkId: context.entry.chunkId,
      domain: context.entry.domain,
      assetFamily: this.readString(context.parsedMetadata.sourceMetadata.assetFamily),
      manifestFingerprint: this.readString(
        context.parsedMetadata.sourceMetadata.manifestFingerprint
      ),
      manifestEntryId: this.readString(context.parsedMetadata.sourceMetadata.manifestEntryId),
      sourceRef: context.parsedMetadata.sourceMetadata.semanticAssetSourceRef,
      sourceVersion: this.readString(context.parsedMetadata.sourceMetadata.sourceVersion),
      policyVersion: this.readString(context.parsedMetadata.sourceMetadata.policyVersion),
      modelingRevision: this.readNumber(context.parsedMetadata.sourceMetadata.modelingRevision),
      visibilityScope: this.readString(context.parsedMetadata.sourceMetadata.visibilityScope),
      preparationStatus: this.readString(
        context.parsedMetadata.sourceMetadata.preparationStatus
      ),
      reasonCodes: this.readStringArray(context.parsedMetadata.sourceMetadata.reasonCodes),
      lifecycleState: "retrieved",
      chunkProfile: this.readString(context.parsedMetadata.chunkProfile),
      startOffset: this.readNumber(context.parsedMetadata.startOffset),
      endOffset: this.readNumber(context.parsedMetadata.endOffset),
      tableNames: this.readStringArray(context.parsedMetadata.tableNames),
      columnNames: this.readStringArray(context.parsedMetadata.columnNames),
      sourceMetadata: this.isRecord(context.parsedMetadata.sourceMetadata)
        ? context.parsedMetadata.sourceMetadata
        : {},
      denseProvider: context.parsedMetadata.denseMetadata?.provider,
      denseModel: context.parsedMetadata.denseMetadata?.model,
      denseDimensions: context.parsedMetadata.denseMetadata?.dimensions,
      vectorVersion: context.parsedMetadata.denseMetadata?.vectorVersion,
      indexVersion: context.parsedMetadata.denseMetadata?.indexVersion,
      scope: context.parsedMetadata.denseMetadata?.scope,
      assetType: context.parsedMetadata.denseMetadata?.assetType
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
    activeModelingRevision?: number;
  }): PriorSqlSelectionResult {
    const trustedSqlExampleCandidates = input.candidates.filter(
      (candidate) =>
        candidate.chunk.metadata.domain === "sql_example" &&
        this.isTrustedPriorSqlCandidate(candidate)
    );
    const eligibleCandidates: RagRetrievalCandidate[] = [];
    const blockedChunkIds = new Set<string>();
    const filteredReasons: string[] = [];
    const staleReasons: string[] = [];
    let staleCandidateCount = 0;
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
        filteredReasons.push(...filterReasons);
        continue;
      }

      const candidateStaleReasons = this.collectPriorSqlStaleReasons({
        candidate,
        activeModelingRevision: input.activeModelingRevision
      });
      if (candidateStaleReasons.length > 0) {
        staleCandidateCount += 1;
        staleReasons.push(...candidateStaleReasons);
        continue;
      }
      eligibleCandidates.push({
        ...candidate,
        evidence: this.unique([...candidate.evidence, "prior_sql:trusted"])
      });
    }

    const selectedCandidates =
      eligibleCandidates.length === 1 ? [eligibleCandidates[0]] : [];
    const shortcutStatus: RagPriorSqlShortcutDecision["status"] =
      selectedCandidates.length === 1
        ? "hit"
        : eligibleCandidates.length > 1
          ? "ambiguous"
          : blockedChunkIds.size > 0
            ? "filtered"
            : staleCandidateCount > 0
              ? "stale"
              : "miss";
    const selectedCandidate = selectedCandidates[0];
    const shortcutReasons = this.unique([
      ...(shortcutStatus === "hit"
        ? ["prior_sql_shortcut_hit"]
        : []),
      ...(shortcutStatus === "miss"
        ? ["prior_sql_no_trusted_match"]
        : []),
      ...(shortcutStatus === "filtered"
        ? ["prior_sql_shortcut_filtered", ...filteredReasons]
        : []),
      ...(shortcutStatus === "stale"
        ? ["prior_sql_shortcut_stale", ...staleReasons]
        : []),
      ...(shortcutStatus === "ambiguous"
        ? ["prior_sql_shortcut_ambiguous"]
        : [])
    ]);
    const laneDegradeReasons = this.unique([
      ...filteredReasons,
      ...staleReasons,
      ...(shortcutStatus === "miss" ? ["prior_sql_no_trusted_match"] : []),
      ...(shortcutStatus === "ambiguous" ? ["prior_sql_shortcut_ambiguous"] : []),
      ...(shortcutStatus === "filtered" ? ["prior_sql_shortcut_filtered"] : []),
      ...(shortcutStatus === "stale" ? ["prior_sql_shortcut_stale"] : [])
    ]);
    const shortcutDecision: RagPriorSqlShortcutDecision =
      this.withPriorSqlShortcutCompatFields({
        status: shortcutStatus,
        reason_codes: shortcutReasons,
        matched_count: trustedSqlExampleCandidates.length,
        eligible_count: eligibleCandidates.length,
        filtered_count: blockedChunkIds.size,
        stale_count: staleCandidateCount,
        ambiguous_count: shortcutStatus === "ambiguous" ? eligibleCandidates.length : 0,
        ...(selectedCandidate
          ? {
              selected_chunk_id: selectedCandidate.chunk_id,
              selected_view_id: this.readPriorSqlViewId(
                selectedCandidate.chunk.metadata.sourceMetadata
              ),
              selected_source_run_id: this.readPriorSqlSourceRunId(
                selectedCandidate.chunk.metadata.sourceMetadata
              )
            }
          : {})
      });
    const lane: RagPriorSqlLaneEvidence = {
      status: shortcutStatus,
      matched_count: trustedSqlExampleCandidates.length,
      selected_count: selectedCandidates.length,
      filtered_count: blockedChunkIds.size,
      stale_count: staleCandidateCount,
      ambiguous_count: shortcutStatus === "ambiguous" ? eligibleCandidates.length : 0,
      eligible_count: eligibleCandidates.length,
      ...(laneDegradeReasons.length > 0
        ? {
            degrade_reasons: laneDegradeReasons
          }
        : {}),
      shortcut: shortcutDecision
    };
    return {
      lane: this.withPriorSqlLaneCompatFields(lane),
      selectedCandidates,
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

  private collectPriorSqlStaleReasons(input: {
    candidate: RagRetrievalCandidate;
    activeModelingRevision?: number;
  }): string[] {
    const sourceMetadata = input.candidate.chunk.metadata.sourceMetadata;
    if (!this.isRecord(sourceMetadata)) {
      return [];
    }
    const reasons: string[] = [];
    if (
      this.readBooleanFlag(sourceMetadata.stale) ||
      this.readBooleanFlag(sourceMetadata.isStale) ||
      this.readBooleanFlag(sourceMetadata.priorSqlStale) ||
      this.readBooleanFlag(sourceMetadata.prior_sql_stale)
    ) {
      reasons.push("prior_sql_stale_marked");
    }
    const viewDeleted =
      this.readBooleanFlag(sourceMetadata.viewDeleted) ||
      this.readBooleanFlag(sourceMetadata.view_deleted);
    const viewExists = this.readOptionalBoolean(
      sourceMetadata.viewExists ?? sourceMetadata.view_exists
    );
    if (viewDeleted || viewExists === false) {
      reasons.push("prior_sql_stale_view_missing");
    }
    const viewStatus = this.readString(sourceMetadata.viewStatus) ??
      this.readString(sourceMetadata.view_status);
    if (viewStatus) {
      const normalized = viewStatus.trim().toLowerCase();
      if (
        normalized === "missing" ||
        normalized === "deleted" ||
        normalized === "not_found" ||
        normalized === "archived" ||
        normalized === "inactive" ||
        normalized === "stale"
      ) {
        reasons.push("prior_sql_stale_view_status");
      }
    }

    const sourceModelingRevision = this.readPositiveInteger(
      sourceMetadata.modelingRevision ?? sourceMetadata.modeling_revision
    );
    const currentModelingRevision = this.readPositiveInteger(
      sourceMetadata.currentModelingRevision ?? sourceMetadata.current_modeling_revision
    );
    if (
      sourceModelingRevision !== undefined &&
      currentModelingRevision !== undefined &&
      sourceModelingRevision !== currentModelingRevision
    ) {
      reasons.push("prior_sql_stale_modeling_revision_mismatch");
    }
    if (
      sourceModelingRevision !== undefined &&
      input.activeModelingRevision !== undefined &&
      sourceModelingRevision !== input.activeModelingRevision
    ) {
      reasons.push("prior_sql_stale_modeling_revision_mismatch");
    }

    const sourceSchemaRevision = this.readPositiveInteger(
      sourceMetadata.schemaRevision ?? sourceMetadata.schema_revision
    );
    const currentSchemaRevision = this.readPositiveInteger(
      sourceMetadata.currentSchemaRevision ?? sourceMetadata.current_schema_revision
    );
    if (
      sourceSchemaRevision !== undefined &&
      currentSchemaRevision !== undefined &&
      sourceSchemaRevision !== currentSchemaRevision
    ) {
      reasons.push("prior_sql_stale_schema_revision_mismatch");
    }
    return this.unique(reasons);
  }

  private readWorkspaceIdFromSourceMetadata(sourceMetadata: unknown): string | undefined {
    if (!this.isRecord(sourceMetadata)) {
      return undefined;
    }
    return this.readString(sourceMetadata.workspaceId) ?? this.readString(sourceMetadata.workspace_id);
  }

  private readPriorSqlViewId(sourceMetadata: unknown): string | undefined {
    if (!this.isRecord(sourceMetadata)) {
      return undefined;
    }
    return this.readString(sourceMetadata.viewId) ?? this.readString(sourceMetadata.view_id);
  }

  private readPriorSqlSourceRunId(sourceMetadata: unknown): string | undefined {
    if (!this.isRecord(sourceMetadata)) {
      return undefined;
    }
    return this.readString(sourceMetadata.sourceRunId) ??
      this.readString(sourceMetadata.source_run_id);
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

  private applyPermissionFiltering(input: {
    candidates: RagRetrievalCandidate[];
    allowedTables: string[];
  }): PermissionFilteringResult {
    if (input.allowedTables.length === 0) {
      return {
        candidates: input.candidates,
        evidence: {
          status: "skipped",
          denied_evidence_ids: [],
          denied_table_names: [],
          denied_column_names: [],
          reason_codes: [],
          kept_candidate_count: input.candidates.length,
          deniedEvidenceIds: [],
          deniedTableNames: [],
          deniedColumnNames: [],
          reasonCodes: [],
          keptCandidateCount: input.candidates.length
        }
      };
    }

    const allowedTableSet = new Set(input.allowedTables.map((table) => table.trim().toLowerCase()));
    const deniedEvidenceIds: string[] = [];
    const deniedTableNames: string[] = [];
    const deniedColumnNames: string[] = [];
    const keptCandidates: RagRetrievalCandidate[] = [];

    for (const candidate of input.candidates) {
      const tableNames = candidate.chunk.metadata.tableNames
        .map((tableName) => tableName.trim().toLowerCase())
        .filter((tableName) => tableName.length > 0);
      if (tableNames.length === 0) {
        keptCandidates.push(candidate);
        continue;
      }
      const deniedTables = tableNames.filter((tableName) => !allowedTableSet.has(tableName));
      if (deniedTables.length === 0) {
        keptCandidates.push(candidate);
        continue;
      }
      deniedEvidenceIds.push(candidate.chunk_id);
      deniedTableNames.push(...deniedTables);
      deniedColumnNames.push(...candidate.chunk.metadata.columnNames);
    }

    const uniqueDeniedEvidenceIds = this.unique(deniedEvidenceIds).slice(0, 128);
    const uniqueDeniedTableNames = this.unique(deniedTableNames).slice(0, 64);
    const uniqueDeniedColumnNames = this.unique(deniedColumnNames).slice(0, 128);
    const reasonCodes =
      uniqueDeniedEvidenceIds.length > 0
        ? ["permission_filtered_not_in_allowed_tables"]
        : [];
    return {
      candidates: keptCandidates,
      evidence: {
        status: uniqueDeniedEvidenceIds.length > 0 ? "applied" : "skipped",
        denied_evidence_ids: uniqueDeniedEvidenceIds,
        denied_table_names: uniqueDeniedTableNames,
        denied_column_names: uniqueDeniedColumnNames,
        reason_codes: reasonCodes,
        kept_candidate_count: keptCandidates.length,
        deniedEvidenceIds: uniqueDeniedEvidenceIds,
        deniedTableNames: uniqueDeniedTableNames,
        deniedColumnNames: uniqueDeniedColumnNames,
        reasonCodes: reasonCodes,
        keptCandidateCount: keptCandidates.length
      }
    };
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

  private applyPermissionFilteringToContexts(input: {
    contexts: RagRetrievalEntryContext[];
    allowedTables: string[];
  }): ContextPermissionFilteringResult {
    if (input.allowedTables.length === 0) {
      return {
        contexts: input.contexts,
        evidence: {
          status: "skipped",
          denied_evidence_ids: [],
          denied_table_names: [],
          denied_column_names: [],
          reason_codes: [],
          kept_candidate_count: input.contexts.length,
          deniedEvidenceIds: [],
          deniedTableNames: [],
          deniedColumnNames: [],
          reasonCodes: [],
          keptCandidateCount: input.contexts.length
        }
      };
    }

    const allowedTableSet = new Set(input.allowedTables.map((table) => table.trim().toLowerCase()));
    const keptContexts: RagRetrievalEntryContext[] = [];
    const deniedEvidenceIds: string[] = [];
    const deniedTableNames: string[] = [];
    const deniedColumnNames: string[] = [];

    for (const context of input.contexts) {
      const tableNames = context.parsedMetadata.tableNames
        .map((tableName) => tableName.trim().toLowerCase())
        .filter((tableName) => tableName.length > 0);
      if (tableNames.length === 0) {
        keptContexts.push(context);
        continue;
      }
      const deniedTables = tableNames.filter((tableName) => !allowedTableSet.has(tableName));
      if (deniedTables.length === 0) {
        keptContexts.push(context);
        continue;
      }
      deniedEvidenceIds.push(context.entry.chunkId);
      deniedTableNames.push(...deniedTables);
      deniedColumnNames.push(...context.parsedMetadata.columnNames);
    }

    const uniqueDeniedEvidenceIds = this.unique(deniedEvidenceIds).slice(0, 128);
    const uniqueDeniedTableNames = this.unique(deniedTableNames).slice(0, 64);
    const uniqueDeniedColumnNames = this.unique(deniedColumnNames).slice(0, 128);
    const reasonCodes =
      uniqueDeniedEvidenceIds.length > 0
        ? ["permission_filtered_before_ranking", "permission_filtered_not_in_allowed_tables"]
        : [];

    return {
      contexts: keptContexts,
      evidence: {
        status: uniqueDeniedEvidenceIds.length > 0 ? "applied" : "skipped",
        denied_evidence_ids: uniqueDeniedEvidenceIds,
        denied_table_names: uniqueDeniedTableNames,
        denied_column_names: uniqueDeniedColumnNames,
        reason_codes: reasonCodes,
        kept_candidate_count: keptContexts.length,
        deniedEvidenceIds: uniqueDeniedEvidenceIds,
        deniedTableNames: uniqueDeniedTableNames,
        deniedColumnNames: uniqueDeniedColumnNames,
        reasonCodes,
        keptCandidateCount: keptContexts.length
      }
    };
  }

  private mergePermissionFilteringEvidence(
    evidences: PermissionFilteringEvidence[]
  ): PermissionFilteringEvidence {
    const applied = evidences.some((evidence) => evidence.status === "applied");
    const deniedEvidenceIds = this.unique(
      evidences.flatMap((evidence) => evidence.denied_evidence_ids ?? [])
    ).slice(0, 128);
    const deniedTableNames = this.unique(
      evidences.flatMap((evidence) => evidence.denied_table_names ?? [])
    ).slice(0, 64);
    const deniedColumnNames = this.unique(
      evidences.flatMap((evidence) => evidence.denied_column_names ?? [])
    ).slice(0, 128);
    const reasonCodes = this.unique(
      evidences.flatMap((evidence) => evidence.reason_codes ?? [])
    );
    const keptCandidateCount = evidences[evidences.length - 1]?.kept_candidate_count ?? 0;
    return {
      status: applied ? "applied" : "skipped",
      denied_evidence_ids: deniedEvidenceIds,
      denied_table_names: deniedTableNames,
      denied_column_names: deniedColumnNames,
      reason_codes: reasonCodes,
      kept_candidate_count: keptCandidateCount,
      deniedEvidenceIds,
      deniedTableNames,
      deniedColumnNames,
      reasonCodes,
      keptCandidateCount
    };
  }

  private applyTwoPassSchemaRecall(input: {
    candidates: RagRetrievalCandidate[];
    contexts: RagRetrievalEntryContext[];
    limit: number;
  }): TwoPassSchemaRecallResult {
    const tableDescriptionCandidates = input.candidates.filter(
      (candidate) => this.readAssetFamily(candidate.chunk.metadata) === "table_description"
    );
    const selectedTableNames = this.unique(
      tableDescriptionCandidates
        .flatMap((candidate) => candidate.chunk.metadata.tableNames)
        .map((tableName) => tableName.trim().toLowerCase())
        .filter((tableName) => tableName.length > 0)
    );
    if (selectedTableNames.length === 0) {
      const evidence = this.emptyTwoPassSchemaRecallEvidence("two_pass_schema_recall_no_table_description");
      return {
        candidates: input.candidates,
        evidence,
        reasonCodes: []
      };
    }

    const supplementalFamilies = new Set(["full_schema", "column_batch", "relationship_binding"]);
    const existingSupplementalCandidates = input.candidates.filter((candidate) => {
      const assetFamily = this.readAssetFamily(candidate.chunk.metadata);
      if (!assetFamily || !supplementalFamilies.has(assetFamily)) {
        return false;
      }
      const tableNames = candidate.chunk.metadata.tableNames.map((tableName) =>
        tableName.trim().toLowerCase()
      );
      return tableNames.some((tableName) => selectedTableNames.includes(tableName));
    });
    const existingChunkIds = new Set(input.candidates.map((candidate) => candidate.chunk_id));
    const supplementalCandidates: RagRetrievalCandidate[] = [];
    for (const context of input.contexts) {
      if (existingChunkIds.has(context.entry.chunkId)) {
        continue;
      }
      const chunk = this.toChunkPayload(context);
      const assetFamily = this.readAssetFamily(chunk.metadata);
      if (!assetFamily || !supplementalFamilies.has(assetFamily)) {
        continue;
      }
      const tableNames = chunk.metadata.tableNames.map((tableName) =>
        tableName.trim().toLowerCase()
      );
      const overlapsSelectedTable = tableNames.some((tableName) =>
        selectedTableNames.includes(tableName)
      );
      const isRelationshipSupplement =
        assetFamily === "relationship_binding" &&
        tableNames.some((tableName) => selectedTableNames.includes(tableName));
      if (!overlapsSelectedTable && !isRelationshipSupplement) {
        continue;
      }
      supplementalCandidates.push({
        chunk_id: chunk.chunk_id,
        source_lane: "graph",
        evidence: this.unique([
          "two_pass_schema_recall",
          `asset_family:${assetFamily}`,
          ...chunk.metadata.tableNames.map((tableName) => `table:${tableName}`)
        ]),
        score: 0.01,
        lane_scores: {
          graph: 0.01
        },
        lane_ranks: {
          graph: input.candidates.length + supplementalCandidates.length + 1
        },
        chunk
      });
      existingChunkIds.add(chunk.chunk_id);
      if (input.candidates.length + supplementalCandidates.length >= input.limit) {
        break;
      }
    }

    const allSupplementalCandidates = [
      ...existingSupplementalCandidates,
      ...supplementalCandidates
    ];
    const supplementalEvidenceIds = this.unique(
      allSupplementalCandidates.map((candidate) => candidate.chunk_id)
    );
    const supplementalFamilyList = this.unique(
      allSupplementalCandidates
        .map((candidate) => this.readAssetFamily(candidate.chunk.metadata))
        .filter((family): family is string => Boolean(family))
    ).sort();
    const reasonCodes =
      supplementalEvidenceIds.length > 0
        ? ["two_pass_schema_recall_applied"]
        : ["two_pass_schema_recall_no_supplement"];
    const evidence: TwoPassSchemaRecallEvidence = {
      status: supplementalEvidenceIds.length > 0 ? "applied" : "skipped",
      selected_table_names: selectedTableNames,
      table_description_evidence_ids: tableDescriptionCandidates.map(
        (candidate) => candidate.chunk_id
      ),
      supplemental_evidence_ids: supplementalEvidenceIds,
      supplemental_families: supplementalFamilyList,
      reason_codes: reasonCodes,
      selectedTableNames: selectedTableNames,
      tableDescriptionEvidenceIds: tableDescriptionCandidates.map(
        (candidate) => candidate.chunk_id
      ),
      supplementalEvidenceIds: supplementalEvidenceIds,
      supplementalFamilies: supplementalFamilyList,
      reasonCodes
    };
    return {
      candidates: [...input.candidates, ...supplementalCandidates],
      evidence,
      reasonCodes
    };
  }

  private emptyTwoPassSchemaRecallEvidence(reasonCode: string): TwoPassSchemaRecallEvidence {
    return {
      status: "skipped",
      selected_table_names: [],
      table_description_evidence_ids: [],
      supplemental_evidence_ids: [],
      supplemental_families: [],
      reason_codes: [reasonCode],
      selectedTableNames: [],
      tableDescriptionEvidenceIds: [],
      supplementalEvidenceIds: [],
      supplementalFamilies: [],
      reasonCodes: [reasonCode]
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

  private attachPermissionFilteringEvidence(
    bundle: RagRetrievalResponse["retrieval_bundle"],
    evidence: PermissionFilteringEvidence | undefined
  ): void {
    const target = bundle as RagRetrievalResponse["retrieval_bundle"] & {
      permission_filtering?: PermissionFilteringEvidence;
      permissionFiltering?: PermissionFilteringEvidence;
    };
    if (!evidence) {
      delete target.permission_filtering;
      delete target.permissionFiltering;
      return;
    }
    target.permission_filtering = evidence;
    target.permissionFiltering = evidence;
  }

  private readPermissionFilteringEvidence(
    bundle: RagRetrievalResponse["retrieval_bundle"]
  ): PermissionFilteringEvidence | undefined {
    const source = bundle as RagRetrievalResponse["retrieval_bundle"] & {
      permission_filtering?: PermissionFilteringEvidence;
      permissionFiltering?: PermissionFilteringEvidence;
    };
    return source.permission_filtering ?? source.permissionFiltering;
  }

  private attachTwoPassSchemaRecallEvidence(
    bundle: RagRetrievalResponse["retrieval_bundle"],
    evidence: TwoPassSchemaRecallEvidence | undefined
  ): void {
    const target = bundle as RagRetrievalResponse["retrieval_bundle"] & {
      two_pass_schema_recall?: TwoPassSchemaRecallEvidence;
      twoPassSchemaRecall?: TwoPassSchemaRecallEvidence;
    };
    if (!evidence) {
      delete target.two_pass_schema_recall;
      delete target.twoPassSchemaRecall;
      return;
    }
    target.two_pass_schema_recall = evidence;
    target.twoPassSchemaRecall = evidence;
  }

  private readTwoPassSchemaRecallEvidence(
    bundle: RagRetrievalResponse["retrieval_bundle"]
  ): TwoPassSchemaRecallEvidence | undefined {
    const source = bundle as RagRetrievalResponse["retrieval_bundle"] & {
      two_pass_schema_recall?: TwoPassSchemaRecallEvidence;
      twoPassSchemaRecall?: TwoPassSchemaRecallEvidence;
    };
    return source.two_pass_schema_recall ?? source.twoPassSchemaRecall;
  }

  private readDenseVectorMetadata(
    context: RagRetrievalEntryContext
  ): DenseVectorMetadata | undefined {
    return context.parsedMetadata.denseMetadata as DenseVectorMetadata | undefined;
  }

  private readAssetFamily(metadata: RagRetrievalChunkMetadata): string | undefined {
    return (
      this.readString(metadata.assetFamily) ??
      this.readString(metadata.sourceMetadata?.assetFamily)
    );
  }

  private countCandidateAssetFamilies(
    candidates: RagRetrievalBundle["candidates"]
  ): Record<string, number> {
    return candidates.reduce<Record<string, number>>((accumulator, candidate) => {
      const family = this.readAssetFamily(candidate.chunk.metadata);
      if (family) {
        accumulator[family] = (accumulator[family] ?? 0) + 1;
      }
      return accumulator;
    }, {});
  }

  private extractManifestFingerprint(sourceVersion: string): string | undefined {
    const [fingerprint] = sourceVersion.trim().split(":");
    return fingerprint || undefined;
  }

  private readDenseVectorMetadataFromParsed(
    parsed: Record<string, unknown>,
    sourceMetadata: Record<string, unknown>
  ): DenseVectorMetadata | undefined {
    const denseRaw = this.isRecord(parsed.dense)
      ? parsed.dense
      : this.isRecord(sourceMetadata.dense)
        ? sourceMetadata.dense
        : undefined;
    if (!denseRaw) {
      return undefined;
    }
    return {
      provider: this.readString(denseRaw.provider),
      model: this.readString(denseRaw.model),
      dimensions: this.readNumber(denseRaw.dimensions),
      vectorVersion: this.readString(denseRaw.vectorVersion),
      indexVersion: this.readString(denseRaw.indexVersion),
      scope: this.readString(denseRaw.scope),
      assetType: this.readString(denseRaw.assetType)
    };
  }

  private toDenseVectorMetadata(metadata: {
    provider: string;
    model: string;
    dimensions: number;
    vectorVersion: string;
    indexVersion?: string;
    scope?: string;
    assetType?: string;
  }): DenseVectorMetadata {
    return {
      provider: metadata.provider,
      model: metadata.model,
      dimensions: metadata.dimensions,
      vectorVersion: metadata.vectorVersion,
      indexVersion: metadata.indexVersion,
      scope: metadata.scope,
      assetType: metadata.assetType
    };
  }

  private isDenseVectorSpaceCompatible(input: {
    queryMetadata?: DenseVectorMetadata;
    candidateMetadata?: DenseVectorMetadata;
    indexVersionId: string;
  }): boolean {
    const { queryMetadata, candidateMetadata, indexVersionId } = input;
    if (!queryMetadata || !candidateMetadata) {
      return false;
    }
    if (
      queryMetadata.dimensions !== undefined &&
      candidateMetadata.dimensions !== undefined &&
      queryMetadata.dimensions !== candidateMetadata.dimensions
    ) {
      return false;
    }
    if (
      queryMetadata.provider &&
      candidateMetadata.provider &&
      queryMetadata.provider !== candidateMetadata.provider
    ) {
      return false;
    }
    if (
      queryMetadata.model &&
      candidateMetadata.model &&
      queryMetadata.model !== candidateMetadata.model
    ) {
      return false;
    }
    if (
      queryMetadata.vectorVersion &&
      candidateMetadata.vectorVersion &&
      queryMetadata.vectorVersion !== candidateMetadata.vectorVersion
    ) {
      return false;
    }
    if (
      candidateMetadata.indexVersion &&
      candidateMetadata.indexVersion !== indexVersionId
    ) {
      return false;
    }
    if (
      queryMetadata.indexVersion &&
      queryMetadata.indexVersion !== indexVersionId
    ) {
      return false;
    }
    return true;
  }

  private resolveDenseUnavailableReason(error: unknown): string {
    if (error instanceof DomainError) {
      return `dense_unavailable:${error.code.toLowerCase()}`;
    }
    if (error instanceof Error) {
      return `dense_unavailable:${error.message.toLowerCase().replace(/\s+/g, "_")}`;
    }
    return "dense_unavailable:unknown_error";
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
    const shortcut = lane.shortcut ?? lane.shortcutDecision;
    return {
      ...lane,
      matched_count: lane.matched_count,
      selected_count: lane.selected_count,
      filtered_count: lane.filtered_count,
      ...(lane.stale_count !== undefined ? { stale_count: lane.stale_count } : {}),
      ...(lane.ambiguous_count !== undefined ? { ambiguous_count: lane.ambiguous_count } : {}),
      ...(lane.eligible_count !== undefined ? { eligible_count: lane.eligible_count } : {}),
      ...(degradeReasons ? { degrade_reasons: degradeReasons } : {}),
      matchedCount: lane.matched_count,
      selectedCount: lane.selected_count,
      filteredCount: lane.filtered_count,
      ...(lane.stale_count !== undefined ? { staleCount: lane.stale_count } : {}),
      ...(lane.ambiguous_count !== undefined ? { ambiguousCount: lane.ambiguous_count } : {}),
      ...(lane.eligible_count !== undefined ? { eligibleCount: lane.eligible_count } : {}),
      ...(degradeReasons ? { degradeReasons } : {}),
      ...(shortcut
        ? {
            shortcut: this.withPriorSqlShortcutCompatFields(shortcut),
            shortcutDecision: this.withPriorSqlShortcutCompatFields(shortcut)
          }
        : {})
    };
  }

  private withPriorSqlShortcutCompatFields(
    decision: RagPriorSqlShortcutDecision
  ): RagPriorSqlShortcutDecision {
    const reasonCodes = decision.reason_codes ?? decision.reasonCodes ?? [];
    return {
      ...decision,
      reason_codes: reasonCodes,
      matched_count: decision.matched_count,
      eligible_count: decision.eligible_count,
      filtered_count: decision.filtered_count,
      stale_count: decision.stale_count,
      ambiguous_count: decision.ambiguous_count,
      ...(decision.selected_chunk_id
        ? {
            selected_chunk_id: decision.selected_chunk_id
          }
        : {}),
      ...(decision.selected_view_id
        ? {
            selected_view_id: decision.selected_view_id
          }
        : {}),
      ...(decision.selected_source_run_id
        ? {
            selected_source_run_id: decision.selected_source_run_id
          }
        : {}),
      reasonCodes,
      matchedCount: decision.matched_count,
      eligibleCount: decision.eligible_count,
      filteredCount: decision.filtered_count,
      staleCount: decision.stale_count,
      ambiguousCount: decision.ambiguous_count,
      ...(decision.selected_chunk_id
        ? {
            selectedChunkId: decision.selected_chunk_id
          }
        : {}),
      ...(decision.selected_view_id
        ? {
            selectedViewId: decision.selected_view_id
          }
        : {}),
      ...(decision.selected_source_run_id
        ? {
            selectedSourceRunId: decision.selected_source_run_id
          }
        : {})
    };
  }

  private buildContextPackLaneMetadata(
    bundle: RagRetrievalResponse["retrieval_bundle"] | undefined
  ): RagContextPackLaneMetadata[] {
    if (!bundle) {
      return [];
    }
    const candidateByChunkId = new Map(
      bundle.candidates.map((candidate) => [candidate.chunk_id, candidate])
    );
    const selectedContext = bundle.selected_context ?? [];
    const selectedByLane = new Map<RagRetrievalLane, string[]>();
    for (const chunk of selectedContext) {
      const lane = candidateByChunkId.get(chunk.chunk_id)?.source_lane;
      if (!lane) {
        continue;
      }
      const selected = selectedByLane.get(lane) ?? [];
      selected.push(chunk.chunk_id);
      selectedByLane.set(lane, selected);
    }

    const laneMetadata: RagContextPackLaneMetadata[] = RAG_RETRIEVAL_LANES.map((lane) => {
      const laneResult = bundle.lane_results[lane];
      const unavailableReason = this.resolveLaneUnavailableReason(laneResult.degrade_reason);
      const state: RagContextPackLaneMetadata["state"] =
        laneResult.status === "ok"
          ? "ready"
          : unavailableReason
            ? "unavailable"
            : "degraded";
      const evidenceIds = laneResult.hits.map((item) => item.chunk_id);
      const selectedEvidenceIds = selectedByLane.get(lane) ?? [];
      const reasonCodes = this.unique([
        laneResult.degrade_reason ?? "",
        ...(bundle.decision_reasons ?? [])
      ]);
      return {
        lane,
        state,
        input_count: laneResult.hits.length,
        inputCount: laneResult.hits.length,
        output_count: laneResult.hits.length,
        outputCount: laneResult.hits.length,
        selected_count: selectedEvidenceIds.length,
        selectedCount: selectedEvidenceIds.length,
        timeout_ms: laneResult.timeout_ms,
        timeoutMs: laneResult.timeout_ms,
        unavailable_reason: unavailableReason,
        unavailableReason: unavailableReason,
        evidence_ids: evidenceIds,
        evidenceIds: evidenceIds,
        reason_codes: reasonCodes,
        reasonCodes: reasonCodes
      };
    });

    const schemaCandidates = bundle.candidates.filter(
      (candidate) => candidate.chunk.metadata.domain === "schema"
    );
    const exampleCandidates = bundle.candidates.filter(
      (candidate) => candidate.chunk.metadata.domain === "sql_example"
    );
    const relationshipHints = bundle.candidates.filter((candidate) =>
      candidate.evidence.some((evidence) => evidence.includes("relationship"))
    );
    const metricTerms = this.unique(bundle.skill_context?.context.map((entry) => entry.term) ?? []);
    const instructionBindings =
      bundle.context_pack?.instruction_sets.model_bindings.length ??
      bundle.context_pack?.instructionSets?.modelBindings?.length ??
      0;
    const priorSqlLane = bundle.prior_sql_lane ?? bundle.priorSqlLane;
    const permissionFiltering = this.readPermissionFilteringEvidence(bundle);
    const permissionReasonCodes = this.unique(permissionFiltering?.reason_codes ?? []);
    const twoPassSchemaRecall = this.readTwoPassSchemaRecallEvidence(bundle);
    const semanticAssetCandidates = bundle.candidates.filter((candidate) =>
      Boolean(this.readAssetFamily(candidate.chunk.metadata))
    );
    const semanticAssetFamilyReasonCodes = this.unique([
      ...(twoPassSchemaRecall?.reason_codes ?? []),
      ...semanticAssetCandidates.flatMap(
        (candidate) => candidate.chunk.metadata.reasonCodes ?? []
      )
    ]);

    laneMetadata.push(
      {
        lane: "schema_ddl_supplement",
        state: schemaCandidates.length > 0 ? "ready" : "degraded",
        input_count: schemaCandidates.length,
        inputCount: schemaCandidates.length,
        output_count: schemaCandidates.length,
        outputCount: schemaCandidates.length,
        selected_count: selectedContext.filter((chunk) => chunk.metadata.domain === "schema").length,
        selectedCount: selectedContext.filter((chunk) => chunk.metadata.domain === "schema").length,
        evidence_ids: schemaCandidates.map((candidate) => candidate.chunk_id),
        evidenceIds: schemaCandidates.map((candidate) => candidate.chunk_id),
        reason_codes: permissionReasonCodes,
        reasonCodes: permissionReasonCodes
      },
      {
        lane: "example_sql",
        state: exampleCandidates.length > 0 ? "ready" : "degraded",
        input_count: exampleCandidates.length,
        inputCount: exampleCandidates.length,
        output_count: exampleCandidates.length,
        outputCount: exampleCandidates.length,
        selected_count: selectedContext.filter((chunk) => chunk.metadata.domain === "sql_example")
          .length,
        selectedCount: selectedContext.filter(
          (chunk) => chunk.metadata.domain === "sql_example"
        ).length,
        evidence_ids: exampleCandidates.map((candidate) => candidate.chunk_id),
        evidenceIds: exampleCandidates.map((candidate) => candidate.chunk_id)
      },
      {
        lane: "relationship",
        state: relationshipHints.length > 0 ? "ready" : "degraded",
        input_count: relationshipHints.length,
        inputCount: relationshipHints.length,
        output_count: relationshipHints.length,
        outputCount: relationshipHints.length,
        selected_count: selectedContext.length,
        selectedCount: selectedContext.length
      },
      {
        lane: "metric",
        state: metricTerms.length > 0 ? "ready" : "degraded",
        input_count: metricTerms.length,
        inputCount: metricTerms.length,
        output_count: metricTerms.length,
        outputCount: metricTerms.length,
        selected_count: metricTerms.length,
        selectedCount: metricTerms.length,
        evidence_ids: metricTerms,
        evidenceIds: metricTerms
      },
      {
        lane: "instruction",
        state: instructionBindings > 0 ? "ready" : "degraded",
        input_count: instructionBindings,
        inputCount: instructionBindings,
        output_count: instructionBindings,
        outputCount: instructionBindings,
        selected_count: instructionBindings,
        selectedCount: instructionBindings
      },
      {
        lane: "saved_prior_sql",
        state:
          priorSqlLane?.status === "hit"
            ? "ready"
            : priorSqlLane?.status
              ? "degraded"
              : "skipped",
        input_count: priorSqlLane?.matched_count ?? 0,
        inputCount: priorSqlLane?.matched_count ?? 0,
        output_count: priorSqlLane?.selected_count ?? 0,
        outputCount: priorSqlLane?.selected_count ?? 0,
        selected_count: priorSqlLane?.selected_count ?? 0,
        selectedCount: priorSqlLane?.selected_count ?? 0,
        reason_codes: this.unique(priorSqlLane?.degrade_reasons ?? []),
        reasonCodes: this.unique(priorSqlLane?.degrade_reasons ?? [])
      },
      {
        lane: "semantic_asset_family",
        state: semanticAssetCandidates.length > 0 ? "ready" : "skipped",
        input_count: semanticAssetCandidates.length,
        inputCount: semanticAssetCandidates.length,
        output_count: semanticAssetCandidates.length,
        outputCount: semanticAssetCandidates.length,
        selected_count: selectedContext.filter((chunk) =>
          Boolean(this.readAssetFamily(chunk.metadata))
        ).length,
        selectedCount: selectedContext.filter((chunk) =>
          Boolean(this.readAssetFamily(chunk.metadata))
        ).length,
        evidence_ids: semanticAssetCandidates.map((candidate) => candidate.chunk_id),
        evidenceIds: semanticAssetCandidates.map((candidate) => candidate.chunk_id),
        reason_codes: semanticAssetFamilyReasonCodes,
        reasonCodes: semanticAssetFamilyReasonCodes
      },
      {
        lane: "dialect_function",
        state:
          bundle.skill_context && bundle.skill_context.skills.length > 0 ? "ready" : "degraded",
        input_count: bundle.skill_context?.skills.length ?? 0,
        inputCount: bundle.skill_context?.skills.length ?? 0,
        output_count: bundle.skill_context?.skills.length ?? 0,
        outputCount: bundle.skill_context?.skills.length ?? 0,
        selected_count: bundle.skill_context?.context.length ?? 0,
        selectedCount: bundle.skill_context?.context.length ?? 0
      }
    );

    return laneMetadata;
  }

  private buildContextPackPruningDecisions(
    bundle: RagRetrievalResponse["retrieval_bundle"] | undefined
  ): RagContextPackPruningDecision[] {
    if (!bundle) {
      return [];
    }
    const selectedEvidenceIds = (bundle.selected_context ?? []).map((chunk) => chunk.chunk_id);
    const removedEvidenceIds = bundle.candidates
      .map((candidate) => candidate.chunk_id)
      .filter((chunkId) => !selectedEvidenceIds.includes(chunkId));
    const decisions: RagContextPackPruningDecision[] = [];

    const retrievalBudgetDecision = this.budgetPolicy.describePruningDecision({
      budgetSource: "retrieval_budget",
      decisionReasons: bundle.decision_reasons ?? [],
      removedEvidenceIds,
      keptEvidenceIds:
        selectedEvidenceIds.length > 0
          ? selectedEvidenceIds
          : bundle.candidates.map((candidate) => candidate.chunk_id)
    });
    if (retrievalBudgetDecision) {
      decisions.push({
        budget_source: retrievalBudgetDecision.budget_source,
        removed_evidence_ids: retrievalBudgetDecision.removed_evidence_ids,
        kept_evidence_ids: retrievalBudgetDecision.kept_evidence_ids,
        reason_codes: retrievalBudgetDecision.reason_codes,
        summary: retrievalBudgetDecision.summary,
        budgetSource: retrievalBudgetDecision.budgetSource,
        removedEvidenceIds: retrievalBudgetDecision.removedEvidenceIds,
        keptEvidenceIds: retrievalBudgetDecision.keptEvidenceIds,
        reasonCodes: retrievalBudgetDecision.reasonCodes
      });
    }

    const columnPruning = this.readColumnPruningEvidence(bundle);
    if (columnPruning && columnPruning.reason_codes.length > 0) {
      const reasonCodes = this.unique(columnPruning.reason_codes);
      decisions.push({
        budget_source: "context_pack",
        removed_evidence_ids: [],
        kept_evidence_ids: selectedEvidenceIds,
        reason_codes: reasonCodes,
        summary: `context_pack:column_pruning:${reasonCodes.join("|")}`,
        budgetSource: "context_pack",
        removedEvidenceIds: [],
        keptEvidenceIds: selectedEvidenceIds,
        reasonCodes
      });
    }

    const permissionFiltering = this.readPermissionFilteringEvidence(bundle);
    if (permissionFiltering?.status === "applied") {
      const reasonCodes = this.unique(permissionFiltering.reason_codes ?? []);
      decisions.push({
        budget_source: "context_pack",
        removed_evidence_ids: permissionFiltering.denied_evidence_ids ?? [],
        kept_evidence_ids: selectedEvidenceIds,
        reason_codes: reasonCodes,
        summary: `context_pack:permission_filtering:${reasonCodes.join("|") || "applied"}`,
        budgetSource: "context_pack",
        removedEvidenceIds: permissionFiltering.denied_evidence_ids ?? [],
        keptEvidenceIds: selectedEvidenceIds,
        reasonCodes
      });
    }

    const twoPassSchemaRecall = this.readTwoPassSchemaRecallEvidence(bundle);
    if (twoPassSchemaRecall && twoPassSchemaRecall.reason_codes.length > 0) {
      const reasonCodes = this.unique(twoPassSchemaRecall.reason_codes);
      decisions.push({
        budget_source: "context_pack",
        removed_evidence_ids: [],
        kept_evidence_ids: twoPassSchemaRecall.supplemental_evidence_ids,
        reason_codes: reasonCodes,
        summary: `context_pack:two_pass_schema_recall:${reasonCodes.join("|")}`,
        budgetSource: "context_pack",
        removedEvidenceIds: [],
        keptEvidenceIds: twoPassSchemaRecall.supplemental_evidence_ids,
        reasonCodes
      });
    }

    return decisions;
  }

  private resolveLaneUnavailableReason(degradeReason: string | undefined): string | undefined {
    if (!degradeReason) {
      return undefined;
    }
    if (degradeReason.includes("unavailable")) {
      return degradeReason;
    }
    return undefined;
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
    const laneMetadata = this.buildContextPackLaneMetadata(bundle);
    const pruningDecisions = this.buildContextPackPruningDecisions(bundle);
    const selectedContextLanes = this.unique(
      selectedContext.map((entry) => entry.metadata.domain)
    );
    const permissionFiltering = bundle
      ? this.readPermissionFilteringEvidence(bundle)
      : undefined;

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
      lane_metadata: laneMetadata,
      laneMetadata: laneMetadata,
      pruning_decisions: pruningDecisions,
      pruningDecisions: pruningDecisions,
      selected_context_lanes: selectedContextLanes,
      selectedContextLanes: selectedContextLanes,
      degrade_reasons: this.unique(input.degradeReasons),
      risk_tags: this.unique(
        input.status === "degraded"
          ? [
              "semantic_spine_degraded",
              ...(permissionFiltering?.status === "applied" ? ["permission_filtered"] : []),
              ...(bundle?.risk_tags ?? [])
            ]
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

  private readPositiveInteger(value: unknown): number | undefined {
    const parsed = this.readNumber(value);
    if (parsed === undefined || !Number.isInteger(parsed) || parsed <= 0) {
      return undefined;
    }
    return parsed;
  }

  private readOptionalBoolean(value: unknown): boolean | undefined {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 0;
    }
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
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
        laneMetadata:
          bundle.lane_metadata ??
          bundle.laneMetadata ??
          bundle.context_pack?.lane_metadata ??
          bundle.context_pack?.laneMetadata ??
          [],
        pruningDecisions:
          bundle.pruning_decisions ??
          bundle.pruningDecisions ??
          bundle.context_pack?.pruning_decisions ??
          bundle.context_pack?.pruningDecisions ??
          [],
        permissionFiltering: this.readPermissionFilteringEvidence(bundle),
        twoPassSchemaRecall: this.readTwoPassSchemaRecallEvidence(bundle),
        skillContext: bundle.skill_context,
        candidates: bundle.candidates.map((candidate) => ({
          chunkId: candidate.chunk_id,
          sourceLane: candidate.source_lane,
          score: candidate.score,
          domain: candidate.chunk.metadata.domain,
          assetFamily: this.readAssetFamily(candidate.chunk.metadata),
          manifestFingerprint: candidate.chunk.metadata.manifestFingerprint,
          sourceVersion: candidate.chunk.metadata.sourceVersion,
          lifecycleState: candidate.chunk.metadata.lifecycleState
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
    candidates: RagRetrievalCandidate[],
    workspaceId?: string
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
        workspaceId,
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
