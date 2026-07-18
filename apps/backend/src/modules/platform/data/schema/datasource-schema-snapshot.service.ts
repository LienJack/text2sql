import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Datasource, DatasourceType } from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { QueryExecutorRouterService } from "../query/index";
import type {
  AllowedSchemaSetV1,
  DatasourceSchemaPolicyInput,
  DatasourceSchemaSnapshotColumnV1,
  DatasourceSchemaSnapshotTableV1,
  DatasourceSchemaSnapshotV1
} from "./schema-snapshot.types";

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
};

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");

@Injectable()
export class DatasourceSchemaSnapshotService {
  constructor(private readonly queryExecutor: QueryExecutorRouterService) {}

  async capture(input: {
    datasource: Datasource;
    policy: DatasourceSchemaPolicyInput;
    capturedAt?: string;
  }): Promise<DatasourceSchemaSnapshotV1> {
    this.assertInput(input.datasource, input.policy);
    const tableNames = this.unique(input.policy.allowedTables);
    const tables = await Promise.all(
      tableNames.map((tableName) => this.captureTable(input.datasource, tableName))
    );
    const catalogIdentity = {
      datasourceId: input.datasource.id,
      datasourceType: input.datasource.type,
      workspaceId: input.policy.workspaceId,
      workspaceDatasourceBindingId: input.policy.workspaceDatasourceBindingId,
      policyVersion: input.policy.policyVersion,
      policyDigest: input.policy.policyDigest,
      tables,
      relationships: []
    };
    const schemaSnapshotDigest = digest(catalogIdentity);
    const columnsByTable = Object.fromEntries(
      tables.map((table) => [
        table.name,
        table.columns.map((column) => column.name)
      ])
    );
    const allowedSchemaIdentity = {
      datasourceId: input.datasource.id,
      policyVersion: input.policy.policyVersion,
      schemaSnapshotDigest,
      tables: tables.map((table) => table.name),
      columnsByTable
    };
    const allowedSchemaSet: AllowedSchemaSetV1 = {
      version: "allowed-schema-set.v1",
      ...allowedSchemaIdentity,
      digest: digest(allowedSchemaIdentity)
    };
    return {
      version: "datasource-schema-snapshot.v1",
      snapshotId: `schema-snapshot:${schemaSnapshotDigest}`,
      digest: schemaSnapshotDigest,
      ...catalogIdentity,
      relationships: [],
      allowedSchemaSet,
      capturedAt: input.capturedAt ?? new Date().toISOString()
    };
  }

  private assertInput(
    datasource: Datasource,
    policy: DatasourceSchemaPolicyInput
  ): void {
    if (datasource.id !== policy.datasourceId) {
      throw new DomainError(
        "SCHEMA_SNAPSHOT_POLICY_MISMATCH",
        "Schema Snapshot 与授权数据源不一致。",
        409
      );
    }
    if (
      !policy.workspaceId.trim() ||
      !policy.workspaceDatasourceBindingId.trim() ||
      !policy.policyDigest.trim() ||
      !Number.isInteger(policy.policyVersion) ||
      policy.policyVersion < 0
    ) {
      throw new DomainError(
        "SCHEMA_SNAPSHOT_POLICY_UNAVAILABLE",
        "缺少可信 Policy Receipt，无法冻结 Schema Snapshot。",
        403
      );
    }
    if (this.unique(policy.allowedTables).length === 0) {
      throw new DomainError(
        "ALLOWED_SCHEMA_EMPTY",
        "授权表集合为空，Text2SQL 必须 fail closed。",
        403
      );
    }
    if (!this.supportsCatalog(datasource.type)) {
      throw new DomainError(
        "SCHEMA_SNAPSHOT_CAPABILITY_UNAVAILABLE",
        "当前数据源不支持权威 Schema Snapshot。",
        400
      );
    }
  }

  private async captureTable(
    datasource: Datasource,
    tableName: string
  ): Promise<DatasourceSchemaSnapshotTableV1> {
    const result = await this.queryExecutor.execute({
      datasource,
      sql: this.buildColumnDiscoverySql(datasource.type, tableName),
      limit: 500
    });
    const columns = result.rows
      .map((row, index) => this.toColumn(row, index))
      .filter((item): item is DatasourceSchemaSnapshotColumnV1 => Boolean(item));
    if (columns.length === 0) {
      throw new DomainError(
        "SCHEMA_SNAPSHOT_TABLE_UNAVAILABLE",
        "授权表无法解析到 Catalog。",
        409,
        { tableName }
      );
    }
    return { name: tableName, columns };
  }

  private buildColumnDiscoverySql(type: DatasourceType, tableName: string): string {
    const escaped = tableName.replace(/'/g, "''");
    if (type === "mysql") {
      return `SELECT column_name AS columnName, data_type AS dataType, is_nullable AS isNullable, column_key AS columnKey, ordinal_position AS ordinalPosition FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${escaped}' ORDER BY ordinal_position`;
    }
    if (type === "postgresql") {
      return `SELECT c.column_name AS columnName, c.data_type AS dataType, c.is_nullable AS isNullable, c.ordinal_position AS ordinalPosition, CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN 'PRI' ELSE '' END AS columnKey FROM information_schema.columns c LEFT JOIN information_schema.key_column_usage kcu ON c.table_schema = kcu.table_schema AND c.table_name = kcu.table_name AND c.column_name = kcu.column_name LEFT JOIN information_schema.table_constraints tc ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema WHERE c.table_schema = 'public' AND c.table_name = '${escaped}' ORDER BY c.ordinal_position`;
    }
    return `SELECT name AS columnName, type AS dataType, CASE WHEN notnull = 0 THEN 'YES' ELSE 'NO' END AS isNullable, pk AS columnKey, cid + 1 AS ordinalPosition FROM pragma_table_info('${escaped}') ORDER BY cid`;
  }

  private toColumn(
    row: Record<string, unknown>,
    index: number
  ): DatasourceSchemaSnapshotColumnV1 | undefined {
    const name = this.readString(row, ["columnName", "column_name", "name"]);
    if (!name) {
      return undefined;
    }
    const dataType =
      this.readString(row, ["dataType", "data_type", "type"]) ?? "unknown";
    const nullable =
      (this.readString(row, ["isNullable", "is_nullable"]) ?? "YES").toUpperCase() ===
      "YES";
    const primaryKeyRaw = row.columnKey ?? row.column_key ?? row.pk;
    const primaryKey =
      primaryKeyRaw === "PRI" || primaryKeyRaw === true || Number(primaryKeyRaw) > 0;
    const ordinalRaw = row.ordinalPosition ?? row.ordinal_position ?? row.cid;
    const ordinal = Number.isFinite(Number(ordinalRaw))
      ? Math.max(1, Number(ordinalRaw))
      : index + 1;
    return {
      name: name.toLowerCase(),
      dataType: dataType.toLowerCase(),
      nullable,
      primaryKey,
      ordinal
    };
  }

  private readString(
    row: Record<string, unknown>,
    keys: string[]
  ): string | undefined {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private supportsCatalog(type: DatasourceType): boolean {
    return type === "sqlite" || type === "mysql" || type === "postgresql";
  }

  private unique(values: string[]): string[] {
    return [...new Set(values.map((item) => item.trim().toLowerCase()).filter(Boolean))]
      .sort();
  }
}
