import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import { getChunkProfileConfig, type RagChunkProfile } from "./chunk-profiles";

export interface RagChunkingInput {
  documentId: string;
  datasourceId: string;
  domain: string;
  chunkProfile: RagChunkProfile;
  content: string;
  documentChecksum: string;
  tableNames: string[];
  columnNames: string[];
  metadata?: Record<string, unknown>;
}

export interface RagChunkDraft {
  id: string;
  chunkOrder: number;
  content: string;
  contentChecksum: string;
  startOffset: number;
  endOffset: number;
  tableNames: string[];
  columnNames: string[];
  metadata?: Record<string, unknown>;
}

@Injectable()
export class RagChunkingService {
  chunk(input: RagChunkingInput): RagChunkDraft[] {
    const normalizedContent = input.content.trim();
    if (!normalizedContent) {
      throw new DomainError("RAG_EMPTY_CONTENT", "RAG 文档内容为空，无法切块。", 400, {
        documentId: input.documentId
      });
    }

    const profileConfig = getChunkProfileConfig(input.chunkProfile);
    const chunks: RagChunkDraft[] = [];
    let startOffset = 0;
    const fullLength = normalizedContent.length;
    while (startOffset < fullLength) {
      if (chunks.length >= profileConfig.hardChunkLimit) {
        throw new DomainError(
          "RAG_CHUNK_LIMIT_EXCEEDED",
          `切块数量超过上限 ${profileConfig.hardChunkLimit}。`,
          400,
          {
            documentId: input.documentId,
            chunkProfile: input.chunkProfile,
            contentLength: fullLength
          }
        );
      }

      const endOffset = Math.min(startOffset + profileConfig.maxCharacters, fullLength);
      const chunkContent = normalizedContent.slice(startOffset, endOffset).trim();
      if (chunkContent.length > 0) {
        const chunkOrder = chunks.length;
        const chunkChecksum = sha256(chunkContent);
        const chunkId = sha256(
          [
            input.documentId,
            input.chunkProfile,
            String(startOffset),
            String(endOffset),
            chunkChecksum,
            input.documentChecksum
          ].join("|")
        );

        chunks.push({
          id: chunkId,
          chunkOrder,
          content: chunkContent,
          contentChecksum: chunkChecksum,
          startOffset,
          endOffset,
          tableNames: [...input.tableNames],
          columnNames: [...input.columnNames],
          metadata: {
            ...(input.metadata ?? {}),
            startOffset,
            endOffset,
            chunkProfile: input.chunkProfile
          }
        });
      }

      if (endOffset >= fullLength) {
        break;
      }

      const nextStart = endOffset - profileConfig.overlapCharacters;
      startOffset = nextStart > startOffset ? nextStart : startOffset + 1;
    }

    if (chunks.length === 0) {
      throw new DomainError("RAG_EMPTY_CONTENT", "RAG 文档无可用切块内容。", 400, {
        documentId: input.documentId
      });
    }

    return chunks;
  }
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
