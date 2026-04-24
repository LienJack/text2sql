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

export type ModelingCalculatedFieldExpressionErrorCategory =
  | "syntax"
  | "type"
  | "ref"
  | "not-supported";

export type ModelingCalculatedFieldExpressionErrorCode =
  "WORKSPACE_MODELING_GRAPH_CALCULATED_FIELD_EXPRESSION_INVALID";

export type ModelingCalculatedFieldExpressionErrorDetails = {
  field: "expression";
  category: ModelingCalculatedFieldExpressionErrorCategory;
  calculatedFieldId: string;
  modelId: string;
  name: string;
  expression: string;
  reason: string;
  position?: number;
  token?: string;
  reference?: string;
  functionName?: string;
  inferredType?: string;
  declaredType?: string;
  leftType?: string;
  rightType?: string;
  allowedTypes?: string[];
  argumentIndex?: number;
};

export type ModelingGraphView = {
  id: string;
  name: string;
  sql: string;
  displayName?: string | null;
  description?: string | null;
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

export type ModelingGraphPatchRequest = {
  policyVersion: number;
  models?: ModelingGraphModel[];
  relationships?: ModelingGraphRelationship[];
  calculatedFields?: ModelingGraphCalculatedField[];
  views?: ModelingGraphView[];
  schemaChanges?: ModelingGraphSchemaChange[];
};

export type ModelingGraphDraft = {
  policyVersion: number;
  revision: number;
  graphHash: string;
  updatedAt: string;
  updatedByActorId?: string;
  graphPayload: ModelingGraphPayload;
};

export type ModelingGraphSnapshot = {
  workspaceId: string;
  datasourceId: string;
  activeRevision?: number;
  draft: ModelingGraphDraft | null;
};
