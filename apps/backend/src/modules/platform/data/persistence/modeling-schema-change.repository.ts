import { Injectable } from "@nestjs/common";
import type { ModelingGraphPayload } from "./modeling-graph.types";

type SchemaChangeRecord = ModelingGraphPayload["schemaChanges"][number];
type ModelingSchemaChangeStatus = SchemaChangeRecord["status"];
type ModelingSchemaChangeDetectable = Pick<
  SchemaChangeRecord,
  "id" | "status" | "kind" | "summary"
>;
type ModelingSchemaChangeAuditEvent = {
  at: string;
  action: "detect" | "resolve";
  outcome: "detected" | "resolved" | "already_resolved" | "not_found";
  changeId?: string;
  policyVersion?: number;
  detectedCount?: number;
  mergedCount?: number;
  unresolvedHighRiskCount?: number;
  persisted?: boolean;
};

const toScopeKey = (workspaceId: string, datasourceId: string): string =>
  `${workspaceId.trim()}::${datasourceId.trim()}`;

@Injectable()
export class ModelingSchemaChangeRepository {
  private readonly scopeRecords = new Map<string, SchemaChangeRecord[]>();
  private readonly scopeAuditEvents = new Map<string, ModelingSchemaChangeAuditEvent[]>();

  mergeDetected(
    existing: SchemaChangeRecord[],
    detected: ModelingSchemaChangeDetectable[]
  ): SchemaChangeRecord[] {
    const merged = new Map<string, SchemaChangeRecord>();

    for (const item of existing) {
      if (item.status === "resolved") {
        merged.set(item.id, {
          id: item.id,
          status: item.status,
          kind: item.kind,
          summary: item.summary
        });
      }
    }

    for (const item of detected) {
      merged.set(item.id, {
        id: item.id,
        status: item.status,
        kind: item.kind,
        summary: item.summary
      });
    }

    return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id));
  }

  areEqual(left: SchemaChangeRecord[], right: SchemaChangeRecord[]): boolean {
    if (left.length !== right.length) {
      return false;
    }
    const sortedLeft = [...left].sort((a, b) => a.id.localeCompare(b.id));
    const sortedRight = [...right].sort((a, b) => a.id.localeCompare(b.id));
    return sortedLeft.every((item, index) => {
      const peer = sortedRight[index];
      return (
        peer !== undefined &&
        item.id === peer.id &&
        item.status === peer.status &&
        item.kind === peer.kind &&
        item.summary === peer.summary
      );
    });
  }

  buildState(schemaChanges: Array<{ id: string; status: ModelingSchemaChangeStatus }>): {
    highRiskStatus: "low" | "high";
    unresolvedHighRiskCount: number;
    unresolvedSchemaChangeIds: string[];
  } {
    const unresolvedSchemaChangeIds = schemaChanges
      .filter((item) => item.status === "detected")
      .map((item) => item.id)
      .sort((left, right) => left.localeCompare(right));
    return {
      highRiskStatus: unresolvedSchemaChangeIds.length > 0 ? "high" : "low",
      unresolvedHighRiskCount: unresolvedSchemaChangeIds.length,
      unresolvedSchemaChangeIds
    };
  }

  resolveByChangeId(records: SchemaChangeRecord[], changeId: string): {
    found: boolean;
    alreadyResolved: boolean;
    updatedRecords: SchemaChangeRecord[];
    targetRecord?: SchemaChangeRecord;
  } {
    const normalizedChangeId = changeId.trim();
    const targetRecord = records.find((item) => item.id === normalizedChangeId);

    if (!targetRecord) {
      return {
        found: false,
        alreadyResolved: false,
        updatedRecords: records
      };
    }

    if (targetRecord.status === "resolved") {
      return {
        found: true,
        alreadyResolved: true,
        updatedRecords: records,
        targetRecord
      };
    }

    const updatedRecords = records.map((item) =>
      item.id === normalizedChangeId ? { ...item, status: "resolved" as const } : item
    );
    const updatedTarget = updatedRecords.find((item) => item.id === normalizedChangeId);

    return {
      found: true,
      alreadyResolved: false,
      updatedRecords,
      targetRecord: updatedTarget
    };
  }

  saveScopeRecords(input: {
    workspaceId: string;
    datasourceId: string;
    records: SchemaChangeRecord[];
  }): SchemaChangeRecord[] {
    const scopeKey = toScopeKey(input.workspaceId, input.datasourceId);
    const normalized = input.records
      .map((item) => ({
        id: item.id,
        status: item.status,
        kind: item.kind,
        summary: item.summary
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    this.scopeRecords.set(scopeKey, normalized);
    return normalized;
  }

  getScopeRecords(input: {
    workspaceId: string;
    datasourceId: string;
  }): SchemaChangeRecord[] {
    const scopeKey = toScopeKey(input.workspaceId, input.datasourceId);
    return [...(this.scopeRecords.get(scopeKey) ?? [])].sort((left, right) =>
      left.id.localeCompare(right.id)
    );
  }

  appendAuditEvent(input: {
    workspaceId: string;
    datasourceId: string;
    event: Omit<ModelingSchemaChangeAuditEvent, "at">;
  }): ModelingSchemaChangeAuditEvent {
    const scopeKey = toScopeKey(input.workspaceId, input.datasourceId);
    const event: ModelingSchemaChangeAuditEvent = {
      ...input.event,
      at: new Date().toISOString()
    };
    const current = this.scopeAuditEvents.get(scopeKey) ?? [];
    this.scopeAuditEvents.set(scopeKey, [...current, event]);
    return event;
  }

  getScopeAuditEvents(input: {
    workspaceId: string;
    datasourceId: string;
  }): ModelingSchemaChangeAuditEvent[] {
    const scopeKey = toScopeKey(input.workspaceId, input.datasourceId);
    return [...(this.scopeAuditEvents.get(scopeKey) ?? [])];
  }
}
