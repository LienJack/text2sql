import { Injectable } from "@nestjs/common";
import type {
  RagPriorSqlLaneEvidence,
  RagPriorSqlShortcutDecision,
  RagRetrievalBundle,
  RagRetrievalChunkPayload
} from "../../../knowledge/rag/retrieval/rag-retrieval.types";

export interface SavedPriorSqlResolution {
  status: "hit" | "miss" | "filtered" | "stale" | "ambiguous";
  reasonCodes: string[];
  selectedChunkId?: string;
  selectedViewId?: string;
  selectedSourceRunId?: string;
  sql?: string;
  explanation?: string;
}

@Injectable()
export class ResolveSavedPriorSqlNode {
  run(input: {
    retrievalBundle?: RagRetrievalBundle;
    question: string;
  }): SavedPriorSqlResolution {
    const lane = this.readPriorSqlLane(input.retrievalBundle);
    if (!lane) {
      return {
        status: "miss",
        reasonCodes: ["prior_sql_lane_missing"]
      };
    }
    const decision = this.readShortcutDecision(lane);
    const status = decision?.status ?? lane.status;
    const reasonCodes = this.readReasonCodes(decision, lane);

    if (status !== "hit") {
      return {
        status,
        reasonCodes,
        selectedChunkId: decision?.selected_chunk_id ?? decision?.selectedChunkId,
        selectedViewId: decision?.selected_view_id ?? decision?.selectedViewId,
        selectedSourceRunId:
          decision?.selected_source_run_id ?? decision?.selectedSourceRunId
      };
    }

    const selectedChunk = this.pickSelectedChunk(input.retrievalBundle, decision);
    const sql = this.extractSql(selectedChunk);
    if (!sql) {
      return {
        status: "miss",
        reasonCodes: ["prior_sql_shortcut_missing_sql"],
        selectedChunkId: selectedChunk?.chunk_id,
        selectedViewId: decision?.selected_view_id ?? decision?.selectedViewId,
        selectedSourceRunId:
          decision?.selected_source_run_id ?? decision?.selectedSourceRunId
      };
    }

    return {
      status: "hit",
      reasonCodes,
      selectedChunkId: selectedChunk?.chunk_id,
      selectedViewId: this.readString(
        selectedChunk?.metadata.sourceMetadata?.viewId ??
          selectedChunk?.metadata.sourceMetadata?.view_id ??
          decision?.selected_view_id ??
          decision?.selectedViewId
      ),
      selectedSourceRunId: this.readString(
        selectedChunk?.metadata.sourceMetadata?.sourceRunId ??
          selectedChunk?.metadata.sourceMetadata?.source_run_id ??
          decision?.selected_source_run_id ??
          decision?.selectedSourceRunId
      ),
      sql,
      explanation: `复用已保存 SQL（问题：${input.question}）。`
    };
  }

  private readPriorSqlLane(
    bundle: RagRetrievalBundle | undefined
  ): RagPriorSqlLaneEvidence | undefined {
    if (!bundle) {
      return undefined;
    }
    return bundle.prior_sql_lane ?? bundle.priorSqlLane;
  }

  private readShortcutDecision(
    lane: RagPriorSqlLaneEvidence
  ): RagPriorSqlShortcutDecision | undefined {
    return lane.shortcut ?? lane.shortcutDecision;
  }

  private readReasonCodes(
    decision: RagPriorSqlShortcutDecision | undefined,
    lane: RagPriorSqlLaneEvidence
  ): string[] {
    const reasonCodes = decision?.reason_codes ?? decision?.reasonCodes ?? [];
    if (reasonCodes.length > 0) {
      return reasonCodes;
    }
    return lane.degrade_reasons ?? lane.degradeReasons ?? [];
  }

  private pickSelectedChunk(
    bundle: RagRetrievalBundle | undefined,
    decision?: RagPriorSqlShortcutDecision
  ): RagRetrievalChunkPayload | undefined {
    if (!bundle) {
      return undefined;
    }
    const selectedChunkId = decision?.selected_chunk_id ?? decision?.selectedChunkId;
    const selectedFromCandidates = bundle.candidates.find(
      (candidate) => candidate.chunk_id === selectedChunkId
    )?.chunk;
    if (selectedFromCandidates) {
      return selectedFromCandidates;
    }
    if (selectedChunkId) {
      return bundle.selected_context?.find((chunk) => chunk.chunk_id === selectedChunkId);
    }
    return bundle.candidates.find((candidate) =>
      candidate.evidence.includes("prior_sql:trusted")
    )?.chunk;
  }

  private extractSql(chunk: RagRetrievalChunkPayload | undefined): string | undefined {
    if (!chunk) {
      return undefined;
    }
    const sourceMetadata = chunk.metadata.sourceMetadata;
    const directSql =
      this.readString(sourceMetadata?.sql) ??
      this.readString(sourceMetadata?.viewSql) ??
      this.readString(sourceMetadata?.view_sql);
    if (directSql) {
      return directSql;
    }

    const fromContent = /\bSQL\s*:\s*([\s\S]+)/i.exec(chunk.content)?.[1];
    const normalized = this.readString(fromContent);
    if (normalized) {
      return normalized;
    }
    return this.readString(chunk.content);
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
}
