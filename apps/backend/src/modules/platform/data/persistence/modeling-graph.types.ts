export type ModelingGraphStatus = "draft" | "active";

export type ModelingGraphColumn = {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  displayName?: string | null;
  description?: string | null;
};

export type ModelingGraphModel = {
  id: string;
  tableName: string;
  modelName: string;
  displayName?: string | null;
  description?: string | null;
  columns: ModelingGraphColumn[];
  nodeSections?: ModelingGraphNodeSections;
  position?: ModelingGraphNodePosition;
};

export type ModelingGraphNodeSections = {
  columns: string[];
  calculatedFields: string[];
  relationships: string[];
};

export type ModelingGraphNodePosition = {
  x: number;
  y: number;
};

export type ModelingGraphRelationship = {
  id: string;
  name?: string;
  source: "manual" | "inferred" | "fk" | "semantic";
  confidence: number;
  type?: ModelingGraphRelationshipType;
  cardinality?: ModelingGraphRelationshipCardinality;
  bridge: {
    left: {
      dataset: string;
      table: string;
      column: string;
    };
    right: {
      dataset: string;
      table: string;
      column: string;
    };
    operator: "eq";
    confidence: number;
  };
};

export type ModelingGraphRelationshipType =
  | "many-to-one"
  | "one-to-many"
  | "one-to-one";

export type ModelingGraphRelationshipCardinality = ModelingGraphRelationshipType;

export type ModelingGraphCalculatedField = {
  id: string;
  modelId: string;
  name: string;
  expression: string;
  dataType: string;
};

export type ModelingGraphView = {
  id: string;
  name: string;
  sql: string;
  displayName?: string | null;
  description?: string | null;
  position?: ModelingGraphNodePosition;
};

export type ModelingGraphSchemaChange = {
  id: string;
  status: "detected" | "resolved";
  kind: "deleted_table" | "deleted_column" | "modified_column_type" | "other";
  summary: string;
};

export type ModelingGraphPayload = {
  models: ModelingGraphModel[];
  relationships: ModelingGraphRelationship[];
  calculatedFields: ModelingGraphCalculatedField[];
  views: ModelingGraphView[];
  schemaChanges: ModelingGraphSchemaChange[];
};

export type ModelingGraphRevisionRecord = {
  id: string;
  workspaceId: string;
  datasourceId: string;
  revision: number;
  status: ModelingGraphStatus;
  graphHash: string;
  graphPayload: ModelingGraphPayload;
  graphPayloadVersion: number;
  createdByActorId?: string | null;
  activatedByActorId?: string | null;
  activatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};
