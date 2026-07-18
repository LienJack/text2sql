import type { DatasourceType } from "@text2sql/shared-types";

export interface DatasourceSchemaSnapshotColumnV1 {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  ordinal: number;
}

export interface DatasourceSchemaSnapshotTableV1 {
  name: string;
  columns: DatasourceSchemaSnapshotColumnV1[];
}

export interface AllowedSchemaSetV1 {
  version: "allowed-schema-set.v1";
  datasourceId: string;
  policyVersion: number;
  schemaSnapshotDigest: string;
  tables: string[];
  columnsByTable: Record<string, string[]>;
  digest: string;
}

export interface DatasourceSchemaSnapshotV1 {
  version: "datasource-schema-snapshot.v1";
  snapshotId: string;
  digest: string;
  datasourceId: string;
  datasourceType: DatasourceType;
  workspaceId: string;
  workspaceDatasourceBindingId: string;
  policyVersion: number;
  policyDigest: string;
  tables: DatasourceSchemaSnapshotTableV1[];
  relationships: Array<{
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
  }>;
  allowedSchemaSet: AllowedSchemaSetV1;
  capturedAt: string;
}

export interface DatasourceSchemaPolicyInput {
  workspaceId: string;
  datasourceId: string;
  workspaceDatasourceBindingId: string;
  policyVersion: number;
  policyDigest: string;
  allowedTables: string[];
}
