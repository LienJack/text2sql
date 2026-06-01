import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { BuildRagIndexJob } from "../../rag/jobs/build-rag-index.job";
import type { RagChunkBuildInput } from "../../rag/index/rag-index.repository";
import { RagIndexRepository } from "../../rag/index/rag-index.repository";
import { RagDocumentFactory } from "../../rag/ingestion/rag-document.factory";
import { RagDocumentRepository } from "../../rag/ingestion/rag-document.repository";
import {
  type SavedPriorSqlCaptureInput,
  type SavedPriorSqlCaptureResult,
  type SavedPriorSqlRecord
} from "../contracts/knowledge-memory.contract";
import { RagReplayRepository } from "../rag/observability/rag-replay.repository";
import { SEMANTIC_ASSET_REASON_CODES } from "../rag/preparation/semantic-asset-reason-codes";

interface NormalizedCaptureInput {
  workspaceId: string;
  datasourceId: string;
  sourceRunId: string;
  sourceRunStatus: string;
  sourceRunCreatedAt?: string;
  question?: string;
  sql: string;
  viewId: string;
  viewName: string;
  viewSql: string;
  tableNames: string[];
  columnNames: string[];
  replayed: boolean;
  savedAt: string;
}

@Injectable()
export class SavedPriorSqlService {
  private readonly records = new Map<string, SavedPriorSqlRecord>();

  constructor(
    private readonly ragReplayRepository: RagReplayRepository,
    private readonly ragDocumentFactory: RagDocumentFactory,
    private readonly ragDocumentRepository: RagDocumentRepository,
    private readonly ragIndexRepository: RagIndexRepository,
    private readonly buildRagIndexJob: BuildRagIndexJob
  ) {}

  async captureFromSavedView(
    input: SavedPriorSqlCaptureInput
  ): Promise<SavedPriorSqlCaptureResult> {
    const normalized = this.normalizeInput(input);
    const priorId = this.buildPriorId({
      workspaceId: normalized.workspaceId,
      datasourceId: normalized.datasourceId,
      viewId: normalized.viewId
    });

    if (normalized.replayed) {
      return this.writeReplayAndReturn({
        outcome: "duplicate",
        reason: "save_replayed",
        priorId,
        input: normalized,
        record: this.getRecord(priorId)
      });
    }

    if (normalized.sourceRunStatus !== "executionResult") {
      return this.writeReplayAndReturn({
        outcome: "skipped_ineligible",
        reason: "source_run_not_execution_result",
        priorId,
        input: normalized
      });
    }

    if (!normalized.question) {
      return this.writeReplayAndReturn({
        outcome: "skipped_ineligible",
        reason: "source_run_question_missing",
        priorId,
        input: normalized
      });
    }

    if (this.records.has(priorId)) {
      return this.writeReplayAndReturn({
        outcome: "duplicate",
        reason: "prior_already_captured",
        priorId,
        input: normalized,
        record: this.getRecord(priorId)
      });
    }

    const record: SavedPriorSqlRecord = {
      priorId,
      workspaceId: normalized.workspaceId,
      datasourceId: normalized.datasourceId,
      sourceRunId: normalized.sourceRunId,
      sourceRunStatus: normalized.sourceRunStatus,
      sourceRunCreatedAt: normalized.sourceRunCreatedAt,
      viewId: normalized.viewId,
      viewName: normalized.viewName,
      question: normalized.question,
      sql: normalized.sql,
      tableNames: this.mergeUniqueTokens(
        normalized.tableNames,
        this.extractTableNames(normalized.sql)
      ),
      columnNames: this.mergeUniqueTokens(
        normalized.columnNames,
        this.extractColumnNames(normalized.sql)
      ),
      savedAt: normalized.savedAt,
      metadata: {
        trusted: true,
        verified: true,
        priorSql: true
      }
    };

    const sourceVersion = this.buildSourceVersion(record);
    const contentChecksum = this.buildContentChecksum(record);
    const documentBuild = this.ragDocumentFactory.create({
      sourceType: "sql_example",
      datasourceId: record.datasourceId,
      sourceVersion,
      contentChecksum,
      sourceRef: `saved_prior_sql:${record.priorId}`,
      exampleId: record.priorId,
      question: record.question,
      sql: record.sql,
      tableNames: record.tableNames,
      columnNames: record.columnNames,
      metadata: {
        trusted: true,
        verified: true,
        priorSql: true,
        assetFamily: "prior_question_sql",
        visibilityScope: "workspace",
        preparationStatus: "prepared",
        reasonCodes: [SEMANTIC_ASSET_REASON_CODES.prepared],
        sourceRef: {
          type: "saved_prior_sql",
          ref: record.priorId
        },
        sourceVersion,
        sourceHash: contentChecksum,
        workspaceId: record.workspaceId,
        datasourceId: record.datasourceId,
        sourceRunId: record.sourceRunId,
        sourceRunStatus: record.sourceRunStatus,
        sourceRunCreatedAt: record.sourceRunCreatedAt,
        viewId: record.viewId,
        viewName: record.viewName,
        viewSql: normalized.viewSql,
        savedAt: record.savedAt,
        viewExists: true,
        viewStatus: "active",
        compatibilitySignals: {
          viewExists: true,
          viewStatus: "active",
          trusted: true,
          verified: true
        }
      }
    });

    await this.ragDocumentRepository.upsertDocumentWithChunks({
      document: documentBuild.document,
      chunks: documentBuild.chunks
    });

    const buildChunks = documentBuild.chunks.map((chunk) =>
      this.toBuildChunkInput(chunk)
    );
    this.ragIndexRepository.upsertChunksForDatasource(record.datasourceId, buildChunks);

    const buildResult = await this.buildRagIndexJob.run({
      datasourceId: record.datasourceId,
      sourceVersion,
      buildReason: "saved_prior_sql_capture",
      runId: record.sourceRunId,
      chunks: buildChunks
    });

    this.records.set(priorId, record);

    return this.writeReplayAndReturn({
      outcome: "captured",
      priorId,
      input: normalized,
      record,
      indexVersionId: buildResult.indexVersionId,
      documentId: documentBuild.document.id,
      chunkCount: documentBuild.chunks.length
    });
  }

  getRecord(priorId: string): SavedPriorSqlRecord | undefined {
    const key = priorId.trim();
    if (!key) {
      return undefined;
    }
    const record = this.records.get(key);
    if (!record) {
      return undefined;
    }
    return this.cloneRecord(record);
  }

  listRecords(): SavedPriorSqlRecord[] {
    return Array.from(this.records.values()).map((item) => this.cloneRecord(item));
  }

  buildPriorId(input: {
    workspaceId: string;
    datasourceId: string;
    viewId: string;
  }): string {
    const workspaceId = this.requireTrimmed(input.workspaceId, "workspaceId");
    const datasourceId = this.requireTrimmed(input.datasourceId, "datasourceId");
    const viewId = this.requireTrimmed(input.viewId, "viewId");
    const digest = createHash("sha256")
      .update(`${workspaceId}|${datasourceId}|${viewId}`)
      .digest("hex");
    return `saved_prior_sql.${digest}`;
  }

  private toBuildChunkInput(chunk: {
    id: string;
    datasourceId: string;
    domain: string;
    content: string;
    metadata?: string;
  }): RagChunkBuildInput {
    return {
      id: chunk.id,
      datasourceId: chunk.datasourceId,
      domain: chunk.domain,
      content: chunk.content,
      metadata: chunk.metadata
    };
  }

  private buildSourceVersion(record: SavedPriorSqlRecord): string {
    const digest = createHash("sha256")
      .update(
        [
          record.workspaceId,
          record.datasourceId,
          record.priorId,
          record.viewId,
          record.question,
          record.sql,
          record.tableNames.join(","),
          record.columnNames.join(",")
        ].join("|")
      )
      .digest("hex");
    return `saved_prior_sql:${record.priorId}:${digest.slice(0, 16)}`;
  }

  private buildContentChecksum(record: SavedPriorSqlRecord): string {
    return createHash("sha256")
      .update(
        [record.question, record.sql, record.tableNames.join(","), record.columnNames.join(",")].join(
          "|"
        )
      )
      .digest("hex");
  }

  private async writeReplayAndReturn(input: {
    outcome: "captured" | "duplicate" | "skipped_ineligible";
    reason?: string;
    priorId: string;
    input: NormalizedCaptureInput;
    record?: SavedPriorSqlRecord;
    indexVersionId?: string;
    documentId?: string;
    chunkCount?: number;
  }): Promise<SavedPriorSqlCaptureResult> {
    const replayKey = this.buildReplayKey(input.outcome, input.priorId);
    await this.ragReplayRepository.writeReplay({
      runId: input.input.sourceRunId,
      replayKey,
      datasourceId: input.input.datasourceId,
      stage: "saved_prior_sql_capture",
      ...(input.indexVersionId ? { indexVersionId: input.indexVersionId } : {}),
      ...(input.documentId ? { documentId: input.documentId } : {}),
      payload: {
        outcome: input.outcome,
        reason: input.reason ?? null,
        priorId: input.priorId,
        workspaceId: input.input.workspaceId,
        datasourceId: input.input.datasourceId,
        sourceRunId: input.input.sourceRunId,
        sourceRunStatus: input.input.sourceRunStatus,
        viewId: input.input.viewId,
        viewName: input.input.viewName,
        replayedSave: input.input.replayed,
        savedAt: input.input.savedAt,
        indexVersionId: input.indexVersionId,
        documentId: input.documentId,
        chunkCount: input.chunkCount ?? 0
      }
    });
    return {
      outcome: input.outcome,
      reason: input.reason,
      priorId: input.priorId,
      replayKey,
      record: input.record ? this.cloneRecord(input.record) : undefined
    };
  }

  private buildReplayKey(
    outcome: "captured" | "duplicate" | "skipped_ineligible",
    priorId: string
  ): string {
    return `saved_prior_sql:${outcome}:${priorId}`;
  }

  private normalizeInput(input: SavedPriorSqlCaptureInput): NormalizedCaptureInput {
    const workspaceId = this.requireTrimmed(input.workspaceId, "workspaceId");
    const datasourceId = this.requireTrimmed(input.datasourceId, "datasourceId");
    const sourceRunId = this.requireTrimmed(input.sourceRunId, "sourceRunId");
    const sourceRunStatus = this.requireTrimmed(
      input.sourceRunStatus,
      "sourceRunStatus"
    );
    const sql = this.requireTrimmed(input.sql, "sql");
    const viewId = this.requireTrimmed(input.viewId, "viewId");
    const viewName = this.requireTrimmed(input.viewName, "viewName");
    const viewSql = this.requireTrimmed(input.viewSql, "viewSql");
    const sourceRunCreatedAt = this.normalizeOptional(input.sourceRunCreatedAt);
    const question = this.normalizeOptional(input.question);
    return {
      workspaceId,
      datasourceId,
      sourceRunId,
      sourceRunStatus,
      sourceRunCreatedAt: sourceRunCreatedAt ?? undefined,
      question: question ?? undefined,
      sql,
      viewId,
      viewName,
      viewSql,
      tableNames: this.mergeUniqueTokens(input.tableNames ?? []),
      columnNames: this.mergeUniqueTokens(input.columnNames ?? []),
      replayed: input.replayed === true,
      savedAt: this.toIsoTimestamp(input.savedAt)
    };
  }

  private cloneRecord(record: SavedPriorSqlRecord): SavedPriorSqlRecord {
    return {
      ...record,
      tableNames: [...record.tableNames],
      columnNames: [...record.columnNames],
      metadata: {
        ...record.metadata
      }
    };
  }

  private mergeUniqueTokens(...sources: string[][]): string[] {
    const dedup = new Set<string>();
    for (const source of sources) {
      for (const raw of source) {
        const normalized = this.normalizeOptional(raw);
        if (!normalized) {
          continue;
        }
        dedup.add(normalized);
      }
    }
    return Array.from(dedup.values());
  }

  private extractTableNames(sql: string): string[] {
    const extracted: string[] = [];
    const matcher = /\b(?:from|join)\s+([A-Za-z0-9_.`"\[\]-]+)/gi;
    let match = matcher.exec(sql);
    while (match) {
      const value = this.cleanSqlIdentifier(match[1] ?? "");
      if (value) {
        extracted.push(value);
      }
      match = matcher.exec(sql);
    }
    return this.mergeUniqueTokens(extracted);
  }

  private extractColumnNames(sql: string): string[] {
    const selectMatch = /^\s*select\s+([\s\S]+?)\s+from\s+/i.exec(sql);
    if (!selectMatch?.[1]) {
      return [];
    }
    const projectedColumns = selectMatch[1]
      .split(",")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .map((segment) => this.normalizeProjectedColumn(segment))
      .filter((segment): segment is string => Boolean(segment));
    return this.mergeUniqueTokens(projectedColumns);
  }

  private normalizeProjectedColumn(segment: string): string | null {
    if (segment === "*") {
      return null;
    }
    const aliasMatch = /\bas\s+([A-Za-z0-9_`"\[\]-]+)\s*$/i.exec(segment);
    if (aliasMatch?.[1]) {
      return this.cleanSqlIdentifier(aliasMatch[1]);
    }
    const parts = segment.split(/\s+/).filter((item) => item.length > 0);
    const canonical = parts[parts.length - 1] ?? segment;
    if (canonical === "*") {
      return null;
    }
    return this.cleanSqlIdentifier(canonical.split(".").pop() ?? canonical);
  }

  private cleanSqlIdentifier(value: string): string | null {
    const normalized = value
      .replace(/^[`"\[]+/, "")
      .replace(/[`"\]]+$/, "")
      .trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toIsoTimestamp(value?: string): string {
    const normalized = this.normalizeOptional(value);
    if (!normalized) {
      return new Date().toISOString();
    }
    const timestamp = Date.parse(normalized);
    if (Number.isNaN(timestamp)) {
      throw new Error(`saved prior sql savedAt illegal timestamp: ${normalized}`);
    }
    return new Date(timestamp).toISOString();
  }

  private normalizeOptional(value: string | undefined | null): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private requireTrimmed(value: string, field: string): string {
    const normalized = this.normalizeOptional(value);
    if (!normalized) {
      throw new Error(`saved prior sql ${field} is required`);
    }
    return normalized;
  }
}
