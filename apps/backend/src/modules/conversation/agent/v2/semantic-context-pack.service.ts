import { Injectable } from "@nestjs/common";
import type { SemanticContextPackV1 } from "@text2sql/shared-types";

interface SemanticContextChunkPayload {
  chunk_id: string;
  content?: string;
  metadata?: unknown;
}

interface SemanticContextRetrievalBundle {
  status?: "ready" | "degraded";
  selected_context?: SemanticContextChunkPayload[];
  degrade_reasons?: string[];
}

interface BuildSemanticContextPackInput {
  retrievalBundle?: SemanticContextRetrievalBundle;
  selectedContext?: SemanticContextChunkPayload[];
  additionalWarnings?: string[];
}

@Injectable()
export class SemanticContextPackService {
  build(input: BuildSemanticContextPackInput): SemanticContextPackV1 {
    const selectedContext =
      input.selectedContext ?? input.retrievalBundle?.selected_context ?? [];
    const selectedEvidenceIds = selectedContext
      .map((chunk) => chunk.chunk_id)
      .filter((chunkId) => chunkId.trim().length > 0)
      .slice(0, 32);

    const selectedTables = this.unique(
      selectedContext
        .flatMap((chunk) => this.readMetadataStringArray(chunk.metadata, "tableNames"))
        .map((value) => this.normalizeIdentifier(value))
        .filter((value): value is string => Boolean(value))
    );

    const selectedColumns = this.unique(
      selectedContext
        .flatMap((chunk) => this.readMetadataStringArray(chunk.metadata, "columnNames"))
        .map((value) => this.normalizeIdentifier(value))
        .filter((value): value is string => Boolean(value))
    );

    const warnings = this.unique([
      ...(input.retrievalBundle?.degrade_reasons ?? []),
      ...(input.additionalWarnings ?? [])
    ]);

    return {
      status: input.retrievalBundle?.status ?? (selectedContext.length > 0 ? "ready" : "degraded"),
      selectedEvidenceIds,
      selectedTables,
      selectedColumns,
      ...(warnings.length > 0 ? { warnings } : {})
    };
  }

  private normalizeIdentifier(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const normalized = value
      .trim()
      .replace(/^[`"'\[\]]+|[`"'\[\]]+$/g, "")
      .replace(/\s+/g, "");
    if (!normalized) {
      return undefined;
    }
    return normalized.toLowerCase();
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
  }

  private readMetadataStringArray(metadata: unknown, key: string): string[] {
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
      return [];
    }
    const value = (metadata as Record<string, unknown>)[key];
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === "string");
  }
}
