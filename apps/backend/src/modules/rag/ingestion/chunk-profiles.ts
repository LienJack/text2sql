export type RagChunkProfile =
  | "schema_table"
  | "schema_column"
  | "sql_example"
  | "semantic_term"
  | "semantic_asset_table_description"
  | "semantic_asset_full_schema"
  | "semantic_asset_column_batch"
  | "semantic_asset_relationship"
  | "semantic_asset_metric"
  | "semantic_asset_calculated_field"
  | "semantic_asset_business_term"
  | "semantic_asset_prompt_instruction"
  | "semantic_asset_prior_question_sql"
  | "semantic_asset_dialect_rule"
  | "semantic_asset_project_metadata";

export interface ChunkProfileConfig {
  maxCharacters: number;
  overlapCharacters: number;
  hardChunkLimit: number;
}

const CHUNK_PROFILE_CONFIGS: Record<RagChunkProfile, ChunkProfileConfig> = {
  schema_table: {
    maxCharacters: 1200,
    overlapCharacters: 120,
    hardChunkLimit: 5000
  },
  schema_column: {
    maxCharacters: 700,
    overlapCharacters: 100,
    hardChunkLimit: 5000
  },
  sql_example: {
    maxCharacters: 1100,
    overlapCharacters: 140,
    hardChunkLimit: 5000
  },
  semantic_term: {
    maxCharacters: 800,
    overlapCharacters: 120,
    hardChunkLimit: 5000
  },
  semantic_asset_table_description: {
    maxCharacters: 900,
    overlapCharacters: 120,
    hardChunkLimit: 5000
  },
  semantic_asset_full_schema: {
    maxCharacters: 1400,
    overlapCharacters: 160,
    hardChunkLimit: 5000
  },
  semantic_asset_column_batch: {
    maxCharacters: 1000,
    overlapCharacters: 120,
    hardChunkLimit: 5000
  },
  semantic_asset_relationship: {
    maxCharacters: 900,
    overlapCharacters: 120,
    hardChunkLimit: 5000
  },
  semantic_asset_metric: {
    maxCharacters: 800,
    overlapCharacters: 100,
    hardChunkLimit: 5000
  },
  semantic_asset_calculated_field: {
    maxCharacters: 800,
    overlapCharacters: 100,
    hardChunkLimit: 5000
  },
  semantic_asset_business_term: {
    maxCharacters: 800,
    overlapCharacters: 100,
    hardChunkLimit: 5000
  },
  semantic_asset_prompt_instruction: {
    maxCharacters: 700,
    overlapCharacters: 100,
    hardChunkLimit: 5000
  },
  semantic_asset_prior_question_sql: {
    maxCharacters: 1100,
    overlapCharacters: 140,
    hardChunkLimit: 5000
  },
  semantic_asset_dialect_rule: {
    maxCharacters: 700,
    overlapCharacters: 100,
    hardChunkLimit: 5000
  },
  semantic_asset_project_metadata: {
    maxCharacters: 700,
    overlapCharacters: 100,
    hardChunkLimit: 5000
  }
};

export const getChunkProfileConfig = (profile: RagChunkProfile): ChunkProfileConfig =>
  CHUNK_PROFILE_CONFIGS[profile];
