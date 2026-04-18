import { Injectable } from "@nestjs/common";
import type {
  RagRetrievalEntryContext,
  RagRetrievalLaneHit
} from "../../rag/retrieval/rag-retrieval.types";

export class GraphAccelerationError extends Error {}

export class GraphAccelerationTimeoutError extends GraphAccelerationError {}

export class GraphAccelerationUnsupportedOperatorError extends GraphAccelerationError {}

export interface GraphAccelerationRunInput {
  query: string;
  contexts: RagRetrievalEntryContext[];
  limit: number;
}

@Injectable()
export class GraphAccelerationAdapter {
  async execute(input: GraphAccelerationRunInput): Promise<RagRetrievalLaneHit[]> {
    this.applyForcedFailureMode();
    const delayMs = this.readPositiveInt(process.env.GRAPH_ACCELERATION_SIMULATED_DELAY_MS, 0);
    if (delayMs > 0) {
      await this.sleep(delayMs);
    }

    const normalizedQuery = input.query.toLowerCase();
    if (normalizedQuery.includes("graph:unsupported")) {
      throw new GraphAccelerationUnsupportedOperatorError(
        "graph acceleration operator unsupported"
      );
    }

    const tokens = this.extractTokens(input.query);
    const hits: RagRetrievalLaneHit[] = [];
    for (const context of input.contexts) {
      const evidence: string[] = ["graph:accelerated"];
      let score = 0;

      if (context.entry.domain === "semantic_term") {
        score += 0.7;
        evidence.push("domain:semantic_term");
      }
      if (context.entry.domain === "schema") {
        score += 0.2;
        evidence.push("domain:schema");
      }

      for (const tableName of context.parsedMetadata.tableNames) {
        const normalizedTable = tableName.toLowerCase();
        if (tokens.some((token) => normalizedTable.includes(token) || token.includes(normalizedTable))) {
          score += 0.85;
          evidence.push(`table:${tableName}`);
        }
      }
      for (const columnName of context.parsedMetadata.columnNames) {
        const normalizedColumn = columnName.toLowerCase();
        if (
          tokens.some((token) => normalizedColumn.includes(token) || token.includes(normalizedColumn))
        ) {
          score += 0.55;
          evidence.push(`column:${columnName}`);
        }
      }

      if (/\b(join|relationship|foreign|关联|外键)\b/i.test(input.query)) {
        score += 0.35;
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
        chunk: {
          chunk_id: context.entry.chunkId,
          content: context.entry.lexicalContent,
          metadata: {
            datasourceId: context.entry.datasourceId,
            indexVersionId: context.indexVersionId,
            chunkId: context.entry.chunkId,
            domain: context.entry.domain,
            chunkProfile:
              typeof context.parsedMetadata.chunkProfile === "string"
                ? context.parsedMetadata.chunkProfile
                : undefined,
            startOffset:
              typeof context.parsedMetadata.startOffset === "number"
                ? context.parsedMetadata.startOffset
                : undefined,
            endOffset:
              typeof context.parsedMetadata.endOffset === "number"
                ? context.parsedMetadata.endOffset
                : undefined,
            tableNames: context.parsedMetadata.tableNames,
            columnNames: context.parsedMetadata.columnNames,
            sourceMetadata: context.parsedMetadata.sourceMetadata
          }
        }
      });
    }
    return this.sortHits(hits).slice(0, input.limit);
  }

  private applyForcedFailureMode(): void {
    const mode = (process.env.GRAPH_ACCELERATION_FORCE_FAILURE ?? "").trim().toLowerCase();
    if (!mode) {
      return;
    }
    if (mode === "timeout") {
      throw new GraphAccelerationTimeoutError("forced graph acceleration timeout");
    }
    if (mode === "unsupported") {
      throw new GraphAccelerationUnsupportedOperatorError("forced unsupported graph operator");
    }
    throw new GraphAccelerationError("forced graph acceleration error");
  }

  private sortHits(hits: RagRetrievalLaneHit[]): RagRetrievalLaneHit[] {
    return [...hits].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.chunk_id.localeCompare(right.chunk_id);
    });
  }

  private extractTokens(query: string): string[] {
    const tokens = query
      .toLowerCase()
      .match(/[a-z0-9_\p{L}\p{N}]+/gu);
    if (!tokens) {
      return [];
    }
    return this.unique(tokens.map((item) => item.trim()).filter((item) => item.length > 0));
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values));
  }

  private readPositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
