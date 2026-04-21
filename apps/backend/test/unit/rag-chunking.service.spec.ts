import { getChunkProfileConfig } from "../../src/modules/rag/ingestion/chunk-profiles";
import { RagChunkingService } from "../../src/modules/rag/ingestion/rag-chunking.service";

const buildLongSchemaText = (): string =>
  Array.from({ length: 260 }, (_, index) => `orders_column_${index} DECIMAL(10,2) NOT NULL`)
    .join(", ");

describe("RagChunkingService", () => {
  const service = new RagChunkingService();

  it("keeps overlap and preserves table/column metadata for long text chunks", () => {
    const chunks = service.chunk({
      documentId: "doc-1",
      datasourceId: "ds-1",
      domain: "schema",
      chunkProfile: "schema_table",
      content: buildLongSchemaText(),
      documentChecksum: "checksum-1",
      tableNames: ["orders"],
      columnNames: ["amount"]
    });
    const profile = getChunkProfileConfig("schema_table");

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]?.startOffset).toBe(chunks[0]?.endOffset - profile.overlapCharacters);
    for (const chunk of chunks) {
      expect(chunk.tableNames).toEqual(["orders"]);
      expect(chunk.columnNames).toEqual(["amount"]);
    }
  });

  it("generates stable chunk ids for same input", () => {
    const input = {
      documentId: "doc-stable",
      datasourceId: "ds-1",
      domain: "sql_example",
      chunkProfile: "sql_example" as const,
      content: Array.from({ length: 180 }, (_, index) => `SELECT ${index} AS n`).join("\n"),
      documentChecksum: "checksum-stable",
      tableNames: ["orders"],
      columnNames: ["id"]
    };

    const first = service.chunk(input);
    const second = service.chunk(input);

    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first.map((item) => item.chunkOrder)).toEqual(second.map((item) => item.chunkOrder));
  });
});
