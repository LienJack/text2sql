import { fuseWithRrf } from "../../src/modules/rag/retrieval/fusion/rrf-fusion";

describe("rrf fusion", () => {
  it("fuses lane scores with deterministic tie-break by chunk_id", () => {
    const result = fuseWithRrf({
      laneHits: {
        lexical: [
          {
            lane: "lexical",
            chunk_id: "chunk-b",
            score: 1,
            evidence: ["lexical"],
            chunk: {
              chunk_id: "chunk-b",
              content: "b",
              metadata: {
                datasourceId: "ds",
                indexVersionId: "idx",
                chunkId: "chunk-b",
                domain: "schema",
                tableNames: [],
                columnNames: [],
                sourceMetadata: {}
              }
            }
          },
          {
            lane: "lexical",
            chunk_id: "chunk-a",
            score: 1,
            evidence: ["lexical"],
            chunk: {
              chunk_id: "chunk-a",
              content: "a",
              metadata: {
                datasourceId: "ds",
                indexVersionId: "idx",
                chunkId: "chunk-a",
                domain: "schema",
                tableNames: [],
                columnNames: [],
                sourceMetadata: {}
              }
            }
          }
        ],
        dense: [],
        graph: []
      },
      rankConstant: 60
    });

    expect(result.map((item) => item.chunk_id)).toEqual(["chunk-a", "chunk-b"]);
    expect(result[0]?.score).toBeGreaterThan(result[1]?.score ?? 0);
  });

  it("keeps stable source lane based on best rank then lane order", () => {
    const result = fuseWithRrf({
      laneHits: {
        lexical: [
          {
            lane: "lexical",
            chunk_id: "chunk-1",
            score: 0.95,
            evidence: ["lexical"],
            chunk: {
              chunk_id: "chunk-1",
              content: "x",
              metadata: {
                datasourceId: "ds",
                indexVersionId: "idx",
                chunkId: "chunk-1",
                domain: "schema",
                tableNames: [],
                columnNames: [],
                sourceMetadata: {}
              }
            }
          }
        ],
        dense: [
          {
            lane: "dense",
            chunk_id: "chunk-1",
            score: 0.95,
            evidence: ["dense"],
            chunk: {
              chunk_id: "chunk-1",
              content: "x",
              metadata: {
                datasourceId: "ds",
                indexVersionId: "idx",
                chunkId: "chunk-1",
                domain: "schema",
                tableNames: [],
                columnNames: [],
                sourceMetadata: {}
              }
            }
          }
        ],
        graph: []
      }
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.source_lane).toBe("lexical");
    expect(result[0]?.lane_ranks).toEqual({
      lexical: 1,
      dense: 1
    });
    expect(result[0]?.evidence).toEqual(expect.arrayContaining(["lexical", "dense"]));
  });

  it("returns empty list when all lanes are empty", () => {
    const result = fuseWithRrf({
      laneHits: {
        lexical: [],
        dense: [],
        graph: []
      }
    });

    expect(result).toEqual([]);
  });
});
