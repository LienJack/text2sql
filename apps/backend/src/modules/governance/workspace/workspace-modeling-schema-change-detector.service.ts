import { Injectable } from "@nestjs/common";
import type { ModelingGraphPayload } from "../../platform/data/persistence/modeling-graph.types";

const normalizeName = (value: string): string => value.trim().toLowerCase();

type SchemaChangeRecord = ModelingGraphPayload["schemaChanges"][number];

type ModelingLiveColumn = {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
};

export type ModelingSchemaChangeKind =
  | "deleted_table"
  | "deleted_column"
  | "modified_column_type"
  | "other";

export type ModelingSchemaChangeStatus = "detected" | "resolved";

export type ModelingSchemaChangeImpact = {
  models: string[];
  relationships: string[];
  calculatedFields: string[];
  views: string[];
};

export type ModelingSchemaChangeDetail = {
  id: string;
  kind: ModelingSchemaChangeKind;
  status: ModelingSchemaChangeStatus;
  summary: string;
  tableName: string;
  modelId?: string;
  columnName?: string;
  expectedDataType?: string;
  currentDataType?: string | null;
  impact: ModelingSchemaChangeImpact;
};

export type ModelingSchemaChangeGroup = {
  deletedTables: ModelingSchemaChangeDetail[];
  deletedColumns: ModelingSchemaChangeDetail[];
  modifiedColumns: ModelingSchemaChangeDetail[];
  other: ModelingSchemaChangeDetail[];
  deleted: ModelingSchemaChangeDetail[];
  modified: ModelingSchemaChangeDetail[];
};

@Injectable()
export class WorkspaceModelingSchemaChangeDetectorService {
  async detect(input: {
    currentPayload: ModelingGraphPayload;
    liveTableNames: string[];
    loadLiveColumns: (tableName: string) => Promise<ModelingLiveColumn[]>;
  }): Promise<{
    items: ModelingSchemaChangeDetail[];
    grouped: ModelingSchemaChangeGroup;
  }> {
    const liveTableSet = new Set(input.liveTableNames.map((item) => normalizeName(item)));
    const storedById = new Map(input.currentPayload.schemaChanges.map((item) => [item.id, item]));
    const items: ModelingSchemaChangeDetail[] = [];

    for (const model of [...input.currentPayload.models].sort((left, right) => left.id.localeCompare(right.id))) {
      const tableName = normalizeName(model.tableName);
      const modelId = model.id;

      if (!liveTableSet.has(tableName)) {
        items.push(
          this.buildSchemaChangeDetail({
            kind: "deleted_table",
            tableName,
            modelId,
            currentPayload: input.currentPayload,
            existingRecord: storedById.get(this.buildSchemaChangeId("deleted_table", tableName))
          })
        );
        continue;
      }

      const liveColumns = await input.loadLiveColumns(tableName);
      const liveColumnByName = new Map(liveColumns.map((item) => [normalizeName(item.name), item]));

      for (const column of [...model.columns].sort((left, right) => left.name.localeCompare(right.name))) {
        const columnName = normalizeName(column.name);
        const liveColumn = liveColumnByName.get(columnName);
        if (!liveColumn) {
          items.push(
            this.buildSchemaChangeDetail({
              kind: "deleted_column",
              tableName,
              modelId,
              columnName,
              expectedDataType: column.dataType,
              currentDataType: null,
              currentPayload: input.currentPayload,
              existingRecord: storedById.get(
                this.buildSchemaChangeId("deleted_column", tableName, columnName)
              )
            })
          );
          continue;
        }

        const expectedDataType = column.dataType.toLowerCase();
        const currentDataType = liveColumn.dataType.toLowerCase();
        const changed =
          expectedDataType !== currentDataType ||
          column.isNullable !== liveColumn.isNullable ||
          column.isPrimaryKey !== liveColumn.isPrimaryKey;

        if (changed) {
          items.push(
            this.buildSchemaChangeDetail({
              kind: "modified_column_type",
              tableName,
              modelId,
              columnName,
              expectedDataType,
              currentDataType,
              currentPayload: input.currentPayload,
              existingRecord: storedById.get(
                this.buildSchemaChangeId("modified_column_type", tableName, columnName)
              )
            })
          );
        }
      }
    }

    const grouped: ModelingSchemaChangeGroup = {
      deletedTables: items.filter((item) => item.kind === "deleted_table"),
      deletedColumns: items.filter((item) => item.kind === "deleted_column"),
      modifiedColumns: items.filter((item) => item.kind === "modified_column_type"),
      other: items.filter((item) => item.kind === "other"),
      deleted: items.filter(
        (item) => item.kind === "deleted_table" || item.kind === "deleted_column"
      ),
      modified: items.filter((item) => item.kind === "modified_column_type")
    };

    return {
      items,
      grouped
    };
  }

  buildSchemaChangeId(
    kind: ModelingSchemaChangeKind,
    tableName: string,
    columnName?: string
  ): string {
    const normalizedTable = normalizeName(tableName);
    const normalizedColumn = columnName ? normalizeName(columnName) : undefined;
    return normalizedColumn
      ? `schema-change:${kind}:${normalizedTable}:${normalizedColumn}`
      : `schema-change:${kind}:${normalizedTable}`;
  }

  parseSchemaChangeId(id: string): {
    kind?: ModelingSchemaChangeKind;
    tableName?: string;
    columnName?: string;
  } | null {
    const parts = id.split(":");
    if (parts.length < 3 || parts[0] !== "schema-change") {
      return null;
    }
    const kindRaw = parts[1] as ModelingSchemaChangeKind | undefined;
    const kind =
      kindRaw === "deleted_table" ||
      kindRaw === "deleted_column" ||
      kindRaw === "modified_column_type" ||
      kindRaw === "other"
        ? kindRaw
        : undefined;
    const tableName = parts[2]?.trim().toLowerCase();
    const columnName = parts[3]?.trim().toLowerCase();
    if (!tableName) {
      return null;
    }
    return {
      kind,
      tableName,
      columnName
    };
  }

  buildSchemaChangeDetailFromStoredRecord(input: {
    record: SchemaChangeRecord;
    currentPayload: ModelingGraphPayload;
  }): ModelingSchemaChangeDetail | null {
    const parsed = this.parseSchemaChangeId(input.record.id);
    if (!parsed?.tableName) {
      return null;
    }

    const model = input.currentPayload.models.find(
      (item) => normalizeName(item.tableName) === parsed.tableName
    );
    const modelId = model?.id ?? parsed.tableName;

    return {
      id: input.record.id,
      kind: parsed.kind ?? input.record.kind,
      status: input.record.status,
      summary: input.record.summary,
      tableName: parsed.tableName,
      modelId,
      columnName: parsed.columnName,
      impact: this.buildSchemaChangeImpact({
        currentPayload: input.currentPayload,
        tableName: parsed.tableName,
        modelId,
        columnName: parsed.columnName
      })
    };
  }

  private buildSchemaChangeDetail(input: {
    kind: ModelingSchemaChangeKind;
    tableName: string;
    modelId: string;
    currentPayload: ModelingGraphPayload;
    existingRecord?: SchemaChangeRecord;
    columnName?: string;
    expectedDataType?: string;
    currentDataType?: string | null;
  }): ModelingSchemaChangeDetail {
    const status: ModelingSchemaChangeStatus =
      input.existingRecord?.status === "resolved" ? "resolved" : "detected";
    const tableLabel = input.tableName;
    const summary =
      input.kind === "deleted_table"
        ? `数据表 ${tableLabel} 已删除。`
        : input.kind === "deleted_column"
          ? `数据表 ${tableLabel} 的字段 ${input.columnName ?? ""} 已删除。`
          : input.kind === "modified_column_type"
            ? `数据表 ${tableLabel} 的字段 ${input.columnName ?? ""} 类型或约束已变化。`
            : `数据表 ${tableLabel}${input.columnName ? `.${input.columnName}` : ""} 出现其他 schema change。`;

    return {
      id: this.buildSchemaChangeId(input.kind, input.tableName, input.columnName),
      kind: input.kind,
      status,
      summary,
      tableName: tableLabel,
      modelId: input.modelId,
      columnName: input.columnName,
      expectedDataType: input.expectedDataType,
      currentDataType: input.currentDataType,
      impact: this.buildSchemaChangeImpact({
        currentPayload: input.currentPayload,
        tableName: input.tableName,
        modelId: input.modelId,
        columnName: input.columnName
      })
    };
  }

  private buildSchemaChangeImpact(input: {
    currentPayload: ModelingGraphPayload;
    tableName: string;
    modelId: string;
    columnName?: string;
  }): ModelingSchemaChangeImpact {
    const tableName = normalizeName(input.tableName);
    const columnName = input.columnName ? normalizeName(input.columnName) : undefined;
    const models = new Set<string>();
    const relationships = new Set<string>();
    const calculatedFields = new Set<string>();
    const views = new Set<string>();

    for (const model of input.currentPayload.models) {
      if (normalizeName(model.tableName) === tableName || model.id === input.modelId) {
        models.add(model.id);
      }
    }

    for (const relationship of input.currentPayload.relationships) {
      const leftMatches =
        normalizeName(relationship.bridge.left.table) === tableName &&
        (!columnName || normalizeName(relationship.bridge.left.column) === columnName);
      const rightMatches =
        normalizeName(relationship.bridge.right.table) === tableName &&
        (!columnName || normalizeName(relationship.bridge.right.column) === columnName);
      if (leftMatches || rightMatches) {
        relationships.add(relationship.id);
      }
    }

    for (const field of input.currentPayload.calculatedFields) {
      if (field.modelId === input.modelId) {
        calculatedFields.add(field.id);
      }
    }

    for (const view of input.currentPayload.views) {
      const haystack = [view.name, view.displayName, view.description, view.sql]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase();
      if (haystack.includes(tableName) || (columnName ? haystack.includes(columnName) : false)) {
        views.add(view.id);
      }
    }

    return {
      models: Array.from(models).sort((left, right) => left.localeCompare(right)),
      relationships: Array.from(relationships).sort((left, right) => left.localeCompare(right)),
      calculatedFields: Array.from(calculatedFields).sort((left, right) =>
        left.localeCompare(right)
      ),
      views: Array.from(views).sort((left, right) => left.localeCompare(right))
    };
  }
}
