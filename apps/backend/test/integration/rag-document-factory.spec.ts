import { DomainError } from "../../src/common/domain-error";
import { RagDocumentFactory } from "../../src/modules/rag/ingestion/rag-document.factory";
import type { IngestionSourceInput } from "../../src/modules/rag/ingestion/ingestion-source.adapter";

describe("RagDocumentFactory integration", () => {
  const factory = new RagDocumentFactory();

  it("maps schema/sql_example/semantic_term sources into normalized document + chunks", () => {
    const schemaResult = factory.create({
      sourceType: "schema",
      datasourceId: "ds-main",
      sourceVersion: "schema-v1",
      contentChecksum: "schema-checksum",
      tableName: "orders",
      columnName: "amount",
      ddl: "amount DECIMAL(10,2) NOT NULL",
      description: "订单金额列"
    });
    const sqlExampleResult = factory.create({
      sourceType: "sql_example",
      datasourceId: "ds-main",
      sourceVersion: "sql-v1",
      contentChecksum: "sql-checksum",
      exampleId: "ex-1",
      question: "统计支付订单总额",
      sql: "SELECT SUM(amount) FROM orders WHERE status = 'paid'",
      tableNames: ["orders"],
      columnNames: ["amount", "status"]
    });
    const semanticTermResult = factory.create({
      sourceType: "semantic_term",
      datasourceId: "ds-main",
      sourceVersion: "term-v1",
      contentChecksum: "term-checksum",
      term: "GMV",
      definition: "一定周期内成交总额",
      synonyms: ["交易额", "销售额"],
      tableNames: ["orders"],
      columnNames: ["amount"]
    });

    expect(schemaResult.document.domain).toBe("schema");
    expect(schemaResult.chunks[0]?.chunkProfile).toBe("schema_column");
    expect(sqlExampleResult.document.domain).toBe("sql_example");
    expect(sqlExampleResult.chunks[0]?.chunkProfile).toBe("sql_example");
    expect(semanticTermResult.document.domain).toBe("semantic_term");
    expect(semanticTermResult.chunks[0]?.chunkProfile).toBe("semantic_term");

    expect(sqlExampleResult.document.tableNames).toEqual(["orders"]);
    expect(sqlExampleResult.document.columnNames).toEqual(["amount", "status"]);
    expect(schemaResult.chunks.length).toBeGreaterThan(0);
    expect(sqlExampleResult.chunks.length).toBeGreaterThan(0);
    expect(semanticTermResult.chunks.length).toBeGreaterThan(0);
  });

  it("rejects inputs missing source_version or content_checksum", () => {
    const missingSourceVersion: IngestionSourceInput = {
      sourceType: "sql_example",
      datasourceId: "ds-main",
      sourceVersion: "",
      contentChecksum: "sql-checksum",
      question: "q",
      sql: "SELECT 1"
    };
    const missingContentChecksum: IngestionSourceInput = {
      sourceType: "semantic_term",
      datasourceId: "ds-main",
      sourceVersion: "term-v1",
      contentChecksum: "",
      term: "ROI",
      definition: "投资回报率"
    };

    expect(() => factory.create(missingSourceVersion)).toThrow(DomainError);
    expect(() => factory.create(missingContentChecksum)).toThrow(DomainError);
  });

  it("produces stable chunk id ordering for the same input", () => {
    const input: IngestionSourceInput = {
      sourceType: "sql_example",
      datasourceId: "ds-main",
      sourceVersion: "sql-v2",
      contentChecksum: "sql-checksum-long",
      question: "列出分区销售额",
      sql: Array.from(
        { length: 220 },
        (_, index) => `SELECT region, SUM(amount) AS gmv_${index} FROM orders GROUP BY region`
      ).join("\n"),
      tableNames: ["orders"],
      columnNames: ["region", "amount"]
    };

    const first = factory.create(input);
    const second = factory.create(input);

    expect(first.chunks.map((item) => item.id)).toEqual(second.chunks.map((item) => item.id));
    expect(first.chunks.map((item) => item.chunkOrder)).toEqual(
      second.chunks.map((item) => item.chunkOrder)
    );
  });

  it("preserves semantic asset family provenance in normalized metadata", () => {
    const result = factory.create({
      sourceType: "semantic_asset",
      datasourceId: "ds-main",
      sourceVersion: "semantic-assets-v1",
      contentChecksum: "asset-checksum",
      sourceRef: "datasource_schema:orders.description",
      assetFamily: "table_description",
      title: "Orders description",
      content: "Table: orders\nDescription: Paid order facts",
      tableNames: ["orders"],
      metadata: {
        manifestFingerprint: "semantic-assets-abc",
        sourceHash: "source-hash",
        visibilityScope: "datasource",
        preparationStatus: "prepared",
        reasonCodes: ["prepared"]
      },
      chunkProfile: "semantic_asset_table_description"
    });

    expect(result.document.domain).toBe("semantic_asset");
    expect(result.chunks[0]?.chunkProfile).toBe("semantic_asset_table_description");
    expect(JSON.parse(result.document.metadata ?? "{}")).toEqual(
      expect.objectContaining({
        assetFamily: "table_description",
        manifestFingerprint: "semantic-assets-abc",
        chunkProfile: "semantic_asset_table_description"
      })
    );
    expect(JSON.parse(result.chunks[0]?.metadata ?? "{}")).toEqual(
      expect.objectContaining({
        assetFamily: "table_description",
        manifestFingerprint: "semantic-assets-abc",
        visibilityScope: "datasource"
      })
    );
  });
});
