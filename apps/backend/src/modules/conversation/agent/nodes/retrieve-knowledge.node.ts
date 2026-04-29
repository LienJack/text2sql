import { Inject, Injectable } from "@nestjs/common";
import type {
  ContextEnvelopePinningEvidence,
  Datasource,
  DatasourceType
} from "@text2sql/shared-types";
import { AppConfigService } from "../../../config/app-config.service";
import { QueryExecutorRouterService } from "../../../platform/data/query/index";
import {
  KNOWLEDGE_RAG_CONTRACT,
  type KnowledgeRagContract
} from "../../../knowledge/contracts/knowledge-rag.contract";
import type {
  RagRetrievalChunkPayload,
  RagContextPack,
  RagRetrievalBundle
} from "../../../knowledge/rag/retrieval/rag-retrieval.types";

export interface RetrievedKnowledgeTypedSummary {
  status: "ready" | "degraded";
  candidateCount: number;
  selectedContextCount: number;
  priorSqlHitCount: number;
  denseState: "ready" | "degraded" | "unavailable" | "skipped";
  denseReason?: string;
  rerankState: "ready" | "degraded" | "unavailable" | "skipped";
  rerankReason?: string;
  pruningDecisionCount: number;
  degradeReasons: string[];
}

export interface RetrievedKnowledge {
  status: "ready" | "degraded";
  snippets: string[];
  summary: string;
  retrievalBundle?: RagRetrievalBundle;
  contextPack?: RagContextPack;
  pinning?: ContextEnvelopePinningEvidence;
  typedSummary: RetrievedKnowledgeTypedSummary;
  evidenceRefs: string[];
}

interface RetrievalPinningConfig {
  enabled: boolean;
  pinnedTables: Set<string>;
  pinnedColumns: Set<string>;
}

interface RetrievalPinningResult {
  bundle: RagRetrievalBundle;
  pinning: ContextEnvelopePinningEvidence;
}

interface LaneStateSummary {
  state: "ready" | "degraded" | "unavailable" | "skipped";
  reason?: string;
}

const MAX_SCHEMA_SUPPLEMENT_TABLES = 4;

const SCHEMA_RELEVANCE_HINTS: Record<string, string[]> = {
  orders: [
    "订单",
    "下单",
    "单量",
    "gmv",
    "销售额",
    "成交额",
    "交易额",
    "金额",
    "营收",
    "sales",
    "revenue",
    "order"
  ],
  order_items: ["订单明细", "商品明细", "明细", "item"],
  payments: ["支付", "付款", "支付方式", "支付渠道", "payment", "method"],
  refunds: ["退款", "退货", "refund"],
  customers: ["客户", "顾客", "customer"],
  users: ["用户", "user"],
  merchants: ["商户", "店铺", "merchant"],
  shipments: ["物流", "发货", "配送", "shipment"],
  products_sku: ["sku", "规格", "库存单位"],
  products_spu: ["spu", "商品", "产品"],
  inventory: ["库存", "inventory"],
  categories: ["类目", "分类", "category"]
};

@Injectable()
export class RetrieveKnowledgeNode {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly queryExecutorRouter: QueryExecutorRouterService,
    @Inject(KNOWLEDGE_RAG_CONTRACT)
    private readonly ragContract: KnowledgeRagContract
  ) {}

  async run(input: {
    question: string;
    datasourceId: string;
    datasource?: Datasource;
    runId: string;
    workspaceId?: string;
    allowedTables?: string[];
    modelCatalogId?: string;
    pinnedTables?: string[];
    pinnedColumns?: string[];
  }): Promise<RetrievedKnowledge> {
    const question = input.question.trim();
    const datasourceId = input.datasourceId.trim();
    const runId = input.runId.trim();
    const pinningConfig = this.normalizePinningConfig({
      pinnedTables: input.pinnedTables,
      pinnedColumns: input.pinnedColumns
    });

    const normalized = question.trim();
    if (!normalized) {
      return this.createDisabledKnowledge({
        query: question,
        datasourceId,
        datasource: input.datasource,
        runId,
        allowedTables: input.allowedTables,
        pinningConfig,
        degradeReason: "empty_question",
        summary: "检索输入为空，已降级到最小执行路径。"
      });
    }

    if (!this.appConfig.agentRagRetrievalEnabled) {
      return this.createDisabledKnowledge({
        query: normalized,
        datasourceId,
        datasource: input.datasource,
        runId,
        allowedTables: input.allowedTables,
        pinningConfig,
        degradeReason: "rag_retrieval_disabled",
        summary: "RAG 检索开关已关闭，已降级到最小执行路径。"
      });
    }

    const retrieved = await this.ragContract.retrieval.retrieve({
      query: normalized,
      datasourceId,
      workspaceId: input.workspaceId,
      allowedTables: input.allowedTables,
      runId
    });
    const reranked = await this.ragContract.rerank.rerank({
      retrievalBundle: retrieved.retrieval_bundle,
      modelCatalogId: input.modelCatalogId
    });
    const pinningResult = this.applyPinningConstraints(
      reranked.retrieval_bundle,
      pinningConfig
    );
    const bundle = await this.withAllowedTableSchemaSupplement(
      pinningResult.bundle,
      input.datasource,
      input.allowedTables
    );
    const pinningSummary =
      pinningResult.pinning.enabled && pinningResult.pinning.status === "applied"
        ? `，pinning[candidates=${pinningResult.pinning.candidateFilteredCount ?? 0},selected=${pinningResult.pinning.selectedContextFilteredCount ?? 0}]`
        : "";
    const priorSqlLane = bundle.prior_sql_lane ?? bundle.priorSqlLane;
    const priorSqlHitCount = priorSqlLane?.selected_count ?? priorSqlLane?.selectedCount ?? 0;
    const snippets = (bundle.selected_context ?? bundle.candidates.map((item) => item.chunk))
      .slice(0, 3)
      .map((item) => item.content.slice(0, 200));
    const denseState = this.resolveLaneState(bundle, "dense");
    const rerankState = this.resolveRerankState(bundle);
    const pruningSummary = this.summarizePruning(bundle);
    const laneSummary = `dense=${denseState},rerank=${rerankState}`;
    const typedSummary = this.buildTypedSummary(bundle);
    const evidenceRefs = this.collectEvidenceRefs(bundle);

    return {
      status: bundle.status,
      snippets,
      summary:
        bundle.status === "ready"
          ? `检索与重排完成，候选=${bundle.candidates.length}，上下文=${bundle.selected_context?.length ?? 0}，priorSQL=${priorSqlHitCount}，${laneSummary}${pruningSummary}${pinningSummary}。`
          : `检索链路降级执行，原因=${bundle.degrade_reasons.join(", ") || "unknown"}，priorSQL=${priorSqlHitCount}，${laneSummary}${pruningSummary}${pinningSummary}。`,
      retrievalBundle: bundle,
      contextPack: bundle.context_pack,
      pinning: pinningResult.pinning,
      typedSummary,
      evidenceRefs
    };
  }

  private normalizePinningConfig(input: {
    pinnedTables?: string[];
    pinnedColumns?: string[];
  }): RetrievalPinningConfig {
    const pinnedTables = this.toNormalizedSet(input.pinnedTables);
    const pinnedColumns = this.toNormalizedSet(input.pinnedColumns);
    return {
      enabled: pinnedTables.size > 0 || pinnedColumns.size > 0,
      pinnedTables,
      pinnedColumns
    };
  }

  private async createDisabledKnowledge(input: {
    query: string;
    datasourceId: string;
    datasource?: Datasource;
    runId: string;
    allowedTables?: string[];
    pinningConfig: RetrievalPinningConfig;
    degradeReason: string;
    summary: string;
  }): Promise<RetrievedKnowledge> {
    const retrievalBundle = await this.withAllowedTableSchemaSupplement(
      this.buildDegradedBundle({
        query: input.query,
        datasourceId: input.datasourceId,
        runId: input.runId,
        degradeReason: input.degradeReason
      }),
      input.datasource,
      input.allowedTables
    );
    const typedSummary = this.buildTypedSummary(retrievalBundle);
    const evidenceRefs = this.collectEvidenceRefs(retrievalBundle);
    return {
      status: "degraded",
      snippets: [],
      summary: input.summary,
      retrievalBundle,
      contextPack: retrievalBundle.context_pack,
      pinning: {
        enabled: input.pinningConfig.enabled,
        status: "inactive",
        candidateFilteredCount: 0,
        selectedContextFilteredCount: 0
      },
      typedSummary,
      evidenceRefs
    };
  }

  private buildDegradedBundle(input: {
    query: string;
    datasourceId: string;
    runId: string;
    degradeReason: string;
  }): RagRetrievalBundle {
    return {
      query: input.query,
      run_id: input.runId,
      datasource_id: input.datasourceId,
      status: "degraded",
      degrade_reasons: [input.degradeReason],
      lane_results: {
        lexical: {
          lane: "lexical",
          status: "degraded",
          timeout_ms: 0,
          elapsed_ms: 0,
          degrade_reason: input.degradeReason,
          hits: []
        },
        dense: {
          lane: "dense",
          status: "degraded",
          timeout_ms: 0,
          elapsed_ms: 0,
          degrade_reason: input.degradeReason,
          hits: []
        },
        graph: {
          lane: "graph",
          status: "degraded",
          timeout_ms: 0,
          elapsed_ms: 0,
          degrade_reason: input.degradeReason,
          hits: []
        }
      },
      candidates: [],
      reranked: [],
      selected_context: [],
      risk_tags: ["rag_zero_recall", input.degradeReason],
      lane_metadata: [
        {
          lane: "dense",
          state: "unavailable",
          unavailable_reason: input.degradeReason,
          reason_codes: [input.degradeReason]
        },
        {
          lane: "rerank",
          state: "skipped",
          fallback_reason: input.degradeReason,
          reason_codes: [input.degradeReason]
        }
      ],
      pruning_decisions: [
        {
          budget_source: "context_pack",
          removed_evidence_ids: [],
          kept_evidence_ids: [],
          reason_codes: [input.degradeReason],
          summary: `context_pack:disabled:${input.degradeReason}`
        }
      ],
      context_pack: {
        status: "degraded",
        semantic_lock_status: "degraded",
        semantic_bindings: {
          model_keys: [],
          relationship_keys: [],
          metric_keys: [],
          calculated_field_keys: []
        },
        instruction_sets: {
          model_bindings: [],
          relationship_bindings: [],
          metric_bindings: [],
          calculated_field_bindings: []
        },
        selected_context_summary: {
          count: 0,
          snippets: []
        },
        lane_metadata: [
          {
            lane: "dense",
            state: "unavailable",
            unavailable_reason: input.degradeReason,
            reason_codes: [input.degradeReason]
          },
          {
            lane: "rerank",
            state: "skipped",
            fallback_reason: input.degradeReason,
            reason_codes: [input.degradeReason]
          }
        ],
        pruning_decisions: [
          {
            budget_source: "context_pack",
            removed_evidence_ids: [],
            kept_evidence_ids: [],
            reason_codes: [input.degradeReason],
            summary: `context_pack:disabled:${input.degradeReason}`
          }
        ],
        selected_context_lanes: [],
        degrade_reasons: [input.degradeReason],
        risk_tags: ["semantic_spine_degraded", input.degradeReason]
      }
    };
  }

  private async withAllowedTableSchemaSupplement(
    bundle: RagRetrievalBundle,
    datasource: Datasource | undefined,
    allowedTables: string[] | undefined
  ): Promise<RagRetrievalBundle> {
    const allowed = this.normalizeAllowedTables(allowedTables);
    if (!datasource || allowed.length === 0) {
      return bundle;
    }

    const selectedTables = this.selectSchemaSupplementTables(bundle.query, allowed);
    if (selectedTables.length === 0) {
      return bundle;
    }

    const chunks = (
      await Promise.all(
        selectedTables.map((tableName) =>
          this.buildSchemaSupplementChunk(datasource, tableName)
        )
      )
    ).filter((chunk): chunk is RagRetrievalChunkPayload => Boolean(chunk));

    if (chunks.length === 0) {
      return bundle;
    }

    const existingSelectedContext = bundle.selected_context ?? [];
    const existingIds = new Set(existingSelectedContext.map((chunk) => chunk.chunk_id));
    const schemaChunks = chunks.filter((chunk) => !existingIds.has(chunk.chunk_id));
    const selectedContext = [...existingSelectedContext, ...schemaChunks];
    const schemaEvidenceIds = schemaChunks.map((chunk) => chunk.chunk_id);
    const existingContextPack = bundle.context_pack;
    const existingPruningDecisions =
      existingContextPack?.pruning_decisions ??
      existingContextPack?.pruningDecisions ??
      [];
    const schemaDecision =
      schemaEvidenceIds.length > 0
        ? [
            {
              budget_source: "context_pack" as const,
              removed_evidence_ids: [],
              kept_evidence_ids: schemaEvidenceIds,
              reason_codes: ["schema_supplement_from_allowed_tables"],
              summary: `context_pack:schema_supplement=${schemaEvidenceIds.length}`
            }
          ]
        : [];

    return {
      ...bundle,
      selected_context: selectedContext,
      context_pack: {
        ...(existingContextPack ?? {
          status: bundle.status,
          semantic_lock_status: "degraded" as const,
          semantic_bindings: {
            model_keys: [],
            relationship_keys: [],
            metric_keys: [],
            calculated_field_keys: []
          },
          instruction_sets: {
            model_bindings: [],
            relationship_bindings: [],
            metric_bindings: [],
            calculated_field_bindings: []
          },
          selected_context_summary: {
            count: 0,
            snippets: []
          },
          degrade_reasons: bundle.degrade_reasons,
          risk_tags: bundle.risk_tags ?? []
        }),
        selected_context_summary: {
          count: selectedContext.length,
          snippets: selectedContext.map((chunk) => chunk.content.slice(0, 200))
        },
        selected_context_lanes: this.unique([
          ...(existingContextPack?.selected_context_lanes ??
            existingContextPack?.selectedContextLanes ??
            []),
          "schema_supplement"
        ]),
        pruning_decisions: [...existingPruningDecisions, ...schemaDecision],
        pruningDecisions: [...existingPruningDecisions, ...schemaDecision]
      }
    };
  }

  private normalizeAllowedTables(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) {
      return [];
    }
    return this.unique(
      values
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0)
    );
  }

  private selectSchemaSupplementTables(question: string, allowedTables: string[]): string[] {
    const normalizedQuestion = question.trim().toLowerCase();
    const ranked = allowedTables
      .map((tableName, index) => ({
        tableName,
        index,
        score: this.scoreSchemaTableRelevance(normalizedQuestion, tableName)
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    if (ranked.length === 0) {
      return allowedTables.length === 1 ? allowedTables : [];
    }

    return ranked
      .slice(0, MAX_SCHEMA_SUPPLEMENT_TABLES)
      .map((item) => item.tableName);
  }

  private scoreSchemaTableRelevance(question: string, tableName: string): number {
    let score = 0;
    const tableTokens = this.identifierTokens(tableName);
    for (const token of tableTokens) {
      if (question.includes(token)) {
        score += 2;
      }
    }
    for (const hint of SCHEMA_RELEVANCE_HINTS[tableName] ?? []) {
      if (question.includes(hint.toLowerCase())) {
        score += 4;
      }
    }
    return score;
  }

  private async buildSchemaSupplementChunk(
    datasource: Datasource,
    tableName: string
  ): Promise<RagRetrievalChunkPayload | undefined> {
    try {
      const result = await this.queryExecutorRouter.execute({
        datasource,
        sql: this.buildColumnDiscoverySql(datasource.type, tableName),
        limit: 200
      });
      const columns = this.unique(
        result.rows
          .map((row: Record<string, unknown>) => this.readColumnName(row))
          .filter((column): column is string => Boolean(column))
      );
      if (columns.length === 0) {
        return undefined;
      }

      const qualifiedColumns = columns.map((column) => `${tableName}.${column}`);
      return {
        chunk_id: `schema-supplement:${datasource.id}:${tableName}`,
        content: `Schema supplement for allowed table ${tableName}: columns=${columns.join(", ")}`,
        metadata: {
          datasourceId: datasource.id,
          indexVersionId: "schema-supplement",
          chunkId: `schema-supplement:${datasource.id}:${tableName}`,
          domain: "schema",
          chunkProfile: "schema_ddl_supplement",
          tableNames: [tableName],
          columnNames: qualifiedColumns,
          sourceMetadata: {
            source: "allowed_table_schema_supplement"
          }
        }
      };
    } catch {
      return undefined;
    }
  }

  private buildColumnDiscoverySql(type: DatasourceType, tableName: string): string {
    const escapedTableName = this.escapeSqlLiteral(tableName);
    if (type === "mysql") {
      return `
SELECT column_name AS columnName, data_type AS dataType
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = '${escapedTableName}'
ORDER BY ordinal_position
      `.trim();
    }
    if (type === "postgresql") {
      return `
SELECT column_name AS columnName, data_type AS dataType
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = '${escapedTableName}'
ORDER BY ordinal_position
      `.trim();
    }
    return `
SELECT name AS columnName, type AS dataType
FROM pragma_table_info('${escapedTableName}')
ORDER BY cid
    `.trim();
  }

  private readColumnName(row: Record<string, unknown>): string | undefined {
    const value = row.columnName ?? row.column_name ?? row.name ?? row.COLUMN_NAME;
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized.toLowerCase() : undefined;
  }

  private identifierTokens(value: string): string[] {
    return this.unique(
      value
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 3)
    );
  }

  private escapeSqlLiteral(value: string): string {
    return value.replace(/'/g, "''");
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }

  private applyPinningConstraints(
    bundle: RagRetrievalBundle,
    pinningConfig: RetrievalPinningConfig
  ): RetrievalPinningResult {
    if (!pinningConfig.enabled) {
      return {
        bundle,
        pinning: {
          enabled: false,
          status: "inactive",
          candidateFilteredCount: 0,
          selectedContextFilteredCount: 0
        }
      };
    }

    const filteredCandidates = bundle.candidates.filter((candidate) =>
      this.matchesPinning(candidate.chunk, pinningConfig)
    );
    const allowedCandidateChunkIds = new Set(
      filteredCandidates.map((candidate) => candidate.chunk_id)
    );
    const filteredSelectedContext = (bundle.selected_context ?? []).filter((chunk) =>
      this.matchesPinning(chunk, pinningConfig)
    );
    const filteredReranked = bundle.reranked?.filter((candidate) =>
      allowedCandidateChunkIds.has(candidate.chunk_id)
    );
    const candidateFilteredCount = Math.max(0, bundle.candidates.length - filteredCandidates.length);
    const selectedContextFilteredCount = Math.max(
      0,
      (bundle.selected_context?.length ?? 0) - filteredSelectedContext.length
    );
    const removedEvidenceIds = (bundle.selected_context ?? [])
      .map((chunk) => chunk.chunk_id)
      .filter((chunkId) => !filteredSelectedContext.some((chunk) => chunk.chunk_id === chunkId));

    const nextBundle: RagRetrievalBundle = {
      ...bundle,
      candidates: filteredCandidates,
      selected_context: filteredSelectedContext,
      ...(filteredReranked
        ? {
            reranked: filteredReranked
          }
        : {}),
      context_pack: this.withPinnedContextPack(
        bundle.context_pack,
        filteredSelectedContext,
        removedEvidenceIds
      )
    };

    return {
      bundle: nextBundle,
      pinning: {
        enabled: true,
        status: "applied",
        candidateFilteredCount,
        selectedContextFilteredCount
      }
    };
  }

  private withPinnedContextPack(
    contextPack: RagContextPack | undefined,
    selectedContext: RagRetrievalChunkPayload[],
    removedEvidenceIds: string[]
  ): RagContextPack | undefined {
    if (!contextPack) {
      return contextPack;
    }
    const existingPruningDecisions =
      contextPack.pruning_decisions ?? contextPack.pruningDecisions ?? [];
    const pinningDecision =
      removedEvidenceIds.length > 0
        ? [
            {
              budget_source: "context_pack" as const,
              removed_evidence_ids: removedEvidenceIds,
              kept_evidence_ids: selectedContext.map((chunk) => chunk.chunk_id),
              reason_codes: ["pinning_filter_applied"],
              summary: `context_pack:pinning_removed=${removedEvidenceIds.length}`
            }
          ]
        : [];
    return {
      ...contextPack,
      selected_context_summary: {
        ...contextPack.selected_context_summary,
        count: selectedContext.length,
        snippets: selectedContext.map((chunk) => chunk.content.slice(0, 200))
      },
      pruning_decisions: [...existingPruningDecisions, ...pinningDecision],
      pruningDecisions: [...existingPruningDecisions, ...pinningDecision]
    };
  }

  private matchesPinning(
    chunk: RagRetrievalChunkPayload,
    pinningConfig: RetrievalPinningConfig
  ): boolean {
    if (pinningConfig.pinnedTables.size > 0) {
      const tableNames = chunk.metadata.tableNames.map((item) => item.trim().toLowerCase());
      const tableMatched = tableNames.some((name) => pinningConfig.pinnedTables.has(name));
      if (!tableMatched) {
        return false;
      }
    }
    if (pinningConfig.pinnedColumns.size > 0) {
      const columnNames = chunk.metadata.columnNames.map((item) => item.trim().toLowerCase());
      const columnMatched = columnNames.some((name) => pinningConfig.pinnedColumns.has(name));
      if (!columnMatched) {
        return false;
      }
    }
    return true;
  }

  private resolveLaneState(bundle: RagRetrievalBundle, lane: "dense" | "lexical" | "graph"): string {
    return this.resolveLaneStateSummary(bundle, lane).state;
  }

  private resolveLaneStateSummary(
    bundle: RagRetrievalBundle,
    lane: "dense" | "lexical" | "graph"
  ): LaneStateSummary {
    const laneMetadata = bundle.context_pack?.lane_metadata ?? bundle.context_pack?.laneMetadata ?? [];
    const laneMetadataEntry = laneMetadata.find((item) => item.lane === lane);
    const metadataState = laneMetadataEntry?.state;
    if (metadataState && metadataState.trim().length > 0) {
      return {
        state: this.normalizeLaneState(metadataState),
        reason: laneMetadataEntry?.unavailable_reason ?? laneMetadataEntry?.fallback_reason
      };
    }
    const laneResult = bundle.lane_results[lane];
    if (laneResult.status === "ok") {
      return {
        state: "ready"
      };
    }
    if ((laneResult.degrade_reason ?? "").includes("unavailable")) {
      return {
        state: "unavailable",
        reason: laneResult.degrade_reason
      };
    }
    return {
      state: "degraded",
      reason: laneResult.degrade_reason
    };
  }

  private resolveRerankState(bundle: RagRetrievalBundle): string {
    return this.resolveRerankStateSummary(bundle).state;
  }

  private resolveRerankStateSummary(bundle: RagRetrievalBundle): LaneStateSummary {
    const laneMetadata = bundle.context_pack?.lane_metadata ?? bundle.context_pack?.laneMetadata ?? [];
    const rerankLane = laneMetadata.find((item) => item.lane === "rerank");
    if (rerankLane?.state) {
      return {
        state: this.normalizeLaneState(rerankLane.state),
        reason: rerankLane.unavailable_reason ?? rerankLane.fallback_reason
      };
    }
    const secondary = bundle.rerank_metadata?.secondary ?? bundle.rerankMetadata?.secondary;
    if (!secondary) {
      return {
        state: "skipped"
      };
    }
    if (secondary.status === "ok") {
      return {
        state: "ready"
      };
    }
    if (secondary.unavailable_reason || secondary.unavailableReason) {
      return {
        state: "unavailable",
        reason: secondary.unavailable_reason ?? secondary.unavailableReason
      };
    }
    return {
      state: this.normalizeLaneState(secondary.status),
      reason: secondary.fallback_reason ?? secondary.fallbackReason
    };
  }

  private summarizePruning(bundle: RagRetrievalBundle): string {
    const pruningDecisions =
      bundle.context_pack?.pruning_decisions ??
      bundle.context_pack?.pruningDecisions ??
      bundle.pruning_decisions ??
      bundle.pruningDecisions ??
      [];
    if (pruningDecisions.length === 0) {
      return "";
    }
    const reasonCount = pruningDecisions.reduce(
      (total, decision) => total + (decision.reason_codes?.length ?? decision.reasonCodes?.length ?? 0),
      0
    );
    return `,pruning[decisions=${pruningDecisions.length},reasons=${reasonCount}]`;
  }

  private toNormalizedSet(values?: string[]): Set<string> {
    if (!Array.isArray(values) || values.length === 0) {
      return new Set<string>();
    }
    return new Set(
      values
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0)
    );
  }

  private buildTypedSummary(bundle: RagRetrievalBundle): RetrievedKnowledgeTypedSummary {
    const dense = this.resolveLaneStateSummary(bundle, "dense");
    const rerank = this.resolveRerankStateSummary(bundle);
    const priorSqlLane = bundle.prior_sql_lane ?? bundle.priorSqlLane;
    const pruningDecisions =
      bundle.context_pack?.pruning_decisions ??
      bundle.context_pack?.pruningDecisions ??
      bundle.pruning_decisions ??
      bundle.pruningDecisions ??
      [];
    return {
      status: bundle.status,
      candidateCount: bundle.candidates.length,
      selectedContextCount: bundle.selected_context?.length ?? 0,
      priorSqlHitCount: priorSqlLane?.selected_count ?? priorSqlLane?.selectedCount ?? 0,
      denseState: dense.state,
      denseReason: dense.reason,
      rerankState: rerank.state,
      rerankReason: rerank.reason,
      pruningDecisionCount: pruningDecisions.length,
      degradeReasons: bundle.degrade_reasons ?? []
    };
  }

  private collectEvidenceRefs(bundle: RagRetrievalBundle): string[] {
    const selectedContextIds = (bundle.selected_context ?? []).map((chunk) => chunk.chunk_id);
    const candidateIds = bundle.candidates.map((candidate) => candidate.chunk_id);
    const laneEvidenceIds = (
      bundle.context_pack?.lane_metadata ??
      bundle.context_pack?.laneMetadata ??
      []
    ).flatMap((lane) => lane.evidence_ids ?? lane.evidenceIds ?? []);
    const pruningKeptIds = (
      bundle.context_pack?.pruning_decisions ??
      bundle.context_pack?.pruningDecisions ??
      []
    ).flatMap((decision) => decision.kept_evidence_ids ?? decision.keptEvidenceIds ?? []);
    return Array.from(
      new Set([...selectedContextIds, ...candidateIds, ...laneEvidenceIds, ...pruningKeptIds])
    ).slice(0, 128);
  }

  private normalizeLaneState(
    value: string
  ): "ready" | "degraded" | "unavailable" | "skipped" {
    if (value === "ready") {
      return "ready";
    }
    if (value === "unavailable") {
      return "unavailable";
    }
    if (value === "skipped") {
      return "skipped";
    }
    return "degraded";
  }
}
