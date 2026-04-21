export type RagChunkProfile =
  | "schema_table"
  | "schema_column"
  | "sql_example"
  | "semantic_term";

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
  }
};

export const getChunkProfileConfig = (profile: RagChunkProfile): ChunkProfileConfig =>
  CHUNK_PROFILE_CONFIGS[profile];
