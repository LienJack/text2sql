const RAG_OWNER_CLASSIFICATION_ENTRIES = [
  {
    file: "apps/backend/src/modules/rag/retrieval/rag-retrieval.service.ts",
    classification: "legacy-active",
    reason:
      "Legacy retrieval service path is pending retirement and must not be used as active owner."
  },
  {
    file: "apps/backend/src/modules/rag/rerank/rag-rerank.service.ts",
    classification: "legacy-active",
    reason:
      "Legacy rerank service path is pending retirement and must not be used as active owner."
  },
  {
    file: "apps/backend/src/modules/rag/retrieval/rag-retrieval.types.ts",
    classification: "legacy-active",
    reason:
      "Legacy retrieval payload type path is pending retirement and must not be imported by new production code."
  },
  {
    file: "apps/backend/src/modules/rag/index/rag-index-builder.service.ts",
    classification: "shared-internal",
    reason: "Shared internal index builder still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/index/rag-index.repository.ts",
    classification: "shared-internal",
    reason: "Shared internal index repository still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/ingestion/rag-document.factory.ts",
    classification: "shared-internal",
    reason: "Shared internal ingestion factory still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/ingestion/rag-document.repository.ts",
    classification: "shared-internal",
    reason: "Shared internal ingestion repository still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/ingestion/ingestion-source.adapter.ts",
    classification: "shared-internal",
    reason: "Shared internal ingestion source adapter still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/ingestion/rag-chunking.service.ts",
    classification: "shared-internal",
    reason: "Shared internal chunking service still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/jobs/build-rag-index.job.ts",
    classification: "shared-internal",
    reason: "Shared internal index build job still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/observability/rag-replay.repository.ts",
    classification: "shared-internal",
    reason: "Shared internal replay persistence adapter still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/quality/rag-quality.service.ts",
    classification: "shared-internal",
    reason: "Shared internal quality service still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/perf/rag-budget-policy.ts",
    classification: "shared-internal",
    reason: "Shared internal budget policy still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/perf/rag-cache-key.factory.ts",
    classification: "shared-internal",
    reason: "Shared internal cache key factory still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/perf/rag-query-cache.service.ts",
    classification: "shared-internal",
    reason: "Shared internal cache service still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/orchestration/rag-datasource-orchestrator.service.ts",
    classification: "shared-internal",
    reason: "Shared internal datasource orchestration still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/orchestration/rag-datasource-quota.policy.ts",
    classification: "shared-internal",
    reason: "Shared internal quota policy still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/audit/rag-audit-replay.service.ts",
    classification: "shared-internal",
    reason: "Shared internal replay audit service still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/events/rag-event-consumer.service.ts",
    classification: "shared-internal",
    reason: "Shared internal event consumer still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/rerank/model-reranker.adapter.ts",
    classification: "shared-internal",
    reason: "Shared internal model reranker adapter still assembled by canonical knowledge/rag owner."
  },
  {
    file: "apps/backend/src/modules/rag/retrieval/fusion/rrf-fusion.ts",
    classification: "shared-internal",
    reason: "Shared internal RRF fusion utility remains reused by canonical owner."
  }
] as const;

export type RagOwnerClassificationEntry = (typeof RAG_OWNER_CLASSIFICATION_ENTRIES)[number];
export type RagOwnerClassification = RagOwnerClassificationEntry["classification"];

const RAG_OWNER_CLASSIFICATION_MAP: Map<string, RagOwnerClassificationEntry> = new Map(
  RAG_OWNER_CLASSIFICATION_ENTRIES.map((entry) => [entry.file, entry])
);

export const KNOWLEDGE_RAG_OWNER_MODULE_PATH =
  "apps/backend/src/modules/knowledge/rag/rag.module.ts";

export function getRagOwnerClassification(
  relativeFilePath: string
): RagOwnerClassificationEntry | undefined {
  return RAG_OWNER_CLASSIFICATION_MAP.get(relativeFilePath);
}

export function isRagSharedInternalPath(relativeFilePath: string): boolean {
  return getRagOwnerClassification(relativeFilePath)?.classification === "shared-internal";
}

export function listRagOwnerClassifications(): readonly RagOwnerClassificationEntry[] {
  return RAG_OWNER_CLASSIFICATION_ENTRIES;
}

export function isKnowledgeRagOwnerClassificationReady(): boolean {
  const hasLegacyActiveCoverage = RAG_OWNER_CLASSIFICATION_ENTRIES.some(
    (entry) => entry.classification === "legacy-active"
  );
  const hasSharedInternalCoverage = RAG_OWNER_CLASSIFICATION_ENTRIES.some(
    (entry) => entry.classification === "shared-internal"
  );
  return hasLegacyActiveCoverage && hasSharedInternalCoverage;
}
