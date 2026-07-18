import { Injectable } from "@nestjs/common";
import type {
  ResolveSqlCatalogInput,
  SqlCatalogResolutionResult,
  SqlCatalogResolvedColumn
} from "./sql-analysis.types";

@Injectable()
export class SqlCatalogResolverService {
  resolve(input: ResolveSqlCatalogInput): SqlCatalogResolutionResult {
    if (input.analysis.status !== "ready") {
      return this.unavailable(input, ["sql_analysis_not_ready"]);
    }
    if (!input.schemaSnapshot) {
      return input.requireSnapshot
        ? this.failed(input, ["schema_snapshot_unavailable"])
        : this.unavailable(input, ["schema_snapshot_unavailable"]);
    }

    const snapshot = input.schemaSnapshot;
    const allowedTables = new Set(
      snapshot.allowedSchemaSet.tables.map((table) => this.normalize(table))
    );
    const snapshotTables = new Map(
      snapshot.tables.map((table) => [this.normalize(table.name), table] as const)
    );
    const resolvedTables: string[] = [];
    const unknownReferences: string[] = [];
    for (const reference of input.analysis.tables) {
      const tableName = this.normalize(reference.normalizedName.split(".").at(-1) ?? "");
      if (!tableName || !allowedTables.has(tableName) || !snapshotTables.has(tableName)) {
        unknownReferences.push("table_reference_unresolved");
        continue;
      }
      resolvedTables.push(tableName);
    }

    const aliases = input.analysis.lineage.aliases;
    const resolvedColumns: SqlCatalogResolvedColumn[] = [];
    const ambiguousReferences: string[] = [];
    for (const reference of input.analysis.columns) {
      if (reference.wildcard) {
        continue;
      }
      const qualifier = reference.table
        ? this.normalize(aliases[this.normalize(reference.table)] ?? reference.table)
        : undefined;
      const candidateTables = qualifier
        ? resolvedTables.filter((table) => table === qualifier.split(".").at(-1))
        : resolvedTables.filter((table) =>
            snapshotTables
              .get(table)
              ?.columns.some((column) => this.normalize(column.name) === this.normalize(reference.name))
          );
      const candidates = candidateTables.filter((table) =>
        snapshotTables
          .get(table)
          ?.columns.some((column) => this.normalize(column.name) === this.normalize(reference.name))
      );
      if (candidates.length === 1 && candidates[0]) {
        const column = this.normalize(reference.name);
        resolvedColumns.push({
          reference,
          table: candidates[0],
          column,
          qualifiedName: `${candidates[0]}.${column}`
        });
      } else if (candidates.length > 1) {
        ambiguousReferences.push("column_reference_ambiguous");
      } else {
        unknownReferences.push("column_reference_unresolved");
      }
    }

    const reasonCodes = Array.from(
      new Set([
        ...(unknownReferences.length > 0 ? ["catalog_reference_unresolved"] : []),
        ...(ambiguousReferences.length > 0 ? ["catalog_reference_ambiguous"] : [])
      ])
    );
    return {
      version: "sql-catalog-resolution.v1",
      status: reasonCodes.length === 0 ? "resolved" : "failed",
      schemaSnapshotId: snapshot.snapshotId,
      schemaSnapshotDigest: snapshot.digest,
      allowedSchemaDigest: snapshot.allowedSchemaSet.digest,
      tables: Array.from(new Set(resolvedTables)),
      columns: this.uniqueColumns(resolvedColumns),
      ambiguousReferences,
      unknownReferences,
      reasonCodes
    };
  }

  private failed(
    input: ResolveSqlCatalogInput,
    reasonCodes: string[]
  ): SqlCatalogResolutionResult {
    return {
      ...this.base(input, reasonCodes),
      status: "failed"
    };
  }

  private unavailable(
    input: ResolveSqlCatalogInput,
    reasonCodes: string[]
  ): SqlCatalogResolutionResult {
    return {
      ...this.base(input, reasonCodes),
      status: "unavailable"
    };
  }

  private base(input: ResolveSqlCatalogInput, reasonCodes: string[]) {
    return {
      version: "sql-catalog-resolution.v1" as const,
      schemaSnapshotId: input.schemaSnapshot?.snapshotId,
      schemaSnapshotDigest: input.schemaSnapshot?.digest,
      allowedSchemaDigest: input.schemaSnapshot?.allowedSchemaSet.digest,
      tables: [] as string[],
      columns: [] as SqlCatalogResolvedColumn[],
      ambiguousReferences: [] as string[],
      unknownReferences: [] as string[],
      reasonCodes
    };
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  private uniqueColumns(values: SqlCatalogResolvedColumn[]): SqlCatalogResolvedColumn[] {
    return Array.from(new Map(values.map((value) => [value.qualifiedName, value])).values());
  }
}
