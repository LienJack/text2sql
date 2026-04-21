import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import {
  IngestionSourceAdapter,
  type IngestionSourceInput
} from "./ingestion-source.adapter";
import { RagChunkingService, type RagChunkDraft } from "./rag-chunking.service";

export interface RagDocumentDraft {
  id: string;
  datasourceId: string;
  domain: string;
  sourceType: string;
  sourceRef?: string;
  sourceVersion: string;
  contentChecksum: string;
  title?: string;
  content: string;
  tableNames: string[];
  columnNames: string[];
  metadata?: string;
}

export interface RagChunkRecordDraft {
  id: string;
  documentId: string;
  datasourceId: string;
  domain: string;
  chunkProfile: string;
  chunkOrder: number;
  content: string;
  contentChecksum: string;
  tableNames: string[];
  columnNames: string[];
  metadata?: string;
}

export interface RagDocumentBuildResult {
  document: RagDocumentDraft;
  chunks: RagChunkRecordDraft[];
}

@Injectable()
export class RagDocumentFactory {
  constructor(
    private readonly sourceAdapter: IngestionSourceAdapter = new IngestionSourceAdapter(),
    private readonly chunkingService: RagChunkingService = new RagChunkingService()
  ) {}

  create(input: IngestionSourceInput): RagDocumentBuildResult {
    const normalized = this.sourceAdapter.normalize(input);
    this.assertMandatoryField(normalized.sourceVersion, "source_version");
    this.assertMandatoryField(normalized.contentChecksum, "content_checksum");
    this.assertMandatoryField(normalized.content, "content");

    const documentId = sha256(
      [
        normalized.datasourceId,
        normalized.sourceType,
        normalized.domain,
        normalized.sourceRef ?? "",
        normalized.sourceVersion,
        normalized.contentChecksum
      ].join("|")
    );

    const document: RagDocumentDraft = {
      id: documentId,
      datasourceId: normalized.datasourceId,
      domain: normalized.domain,
      sourceType: normalized.sourceType,
      sourceRef: normalized.sourceRef,
      sourceVersion: normalized.sourceVersion,
      contentChecksum: normalized.contentChecksum,
      title: normalized.title,
      content: normalized.content,
      tableNames: [...normalized.tableNames],
      columnNames: [...normalized.columnNames],
      metadata: this.serializeMetadata({
        chunkProfile: normalized.chunkProfile,
        ...(normalized.metadata ?? {})
      })
    };

    const chunkDrafts = this.chunkingService.chunk({
      documentId,
      datasourceId: normalized.datasourceId,
      domain: normalized.domain,
      chunkProfile: normalized.chunkProfile,
      content: normalized.content,
      documentChecksum: normalized.contentChecksum,
      tableNames: normalized.tableNames,
      columnNames: normalized.columnNames,
      metadata: normalized.metadata
    });

    return {
      document,
      chunks: chunkDrafts.map((chunk) => this.mapChunkDraftToRecord(normalized.chunkProfile, documentId, normalized.datasourceId, normalized.domain, chunk))
    };
  }

  private mapChunkDraftToRecord(
    chunkProfile: string,
    documentId: string,
    datasourceId: string,
    domain: string,
    chunk: RagChunkDraft
  ): RagChunkRecordDraft {
    return {
      id: chunk.id,
      documentId,
      datasourceId,
      domain,
      chunkProfile,
      chunkOrder: chunk.chunkOrder,
      content: chunk.content,
      contentChecksum: chunk.contentChecksum,
      tableNames: [...chunk.tableNames],
      columnNames: [...chunk.columnNames],
      metadata: this.serializeMetadata(chunk.metadata)
    };
  }

  private assertMandatoryField(value: string | undefined, fieldName: string): void {
    if (!value || value.trim().length === 0) {
      throw new DomainError(
        "RAG_DOCUMENT_REQUIRED_FIELD_MISSING",
        `RAG 文档缺少必填字段: ${fieldName}。`,
        400,
        { fieldName }
      );
    }
  }

  private serializeMetadata(metadata?: Record<string, unknown>): string | undefined {
    if (!metadata || Object.keys(metadata).length === 0) {
      return undefined;
    }
    return JSON.stringify(metadata);
  }
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
