import { RetrieveKnowledgeNode } from "../../src/modules/conversation/agent/nodes/retrieve-knowledge.node";

describe("RetrieveKnowledgeNode", () => {
  it("adds schema supplement chunks for relevant allowed tables when RAG retrieval is disabled", async () => {
    const queryExecutorRouter = {
      execute: jest.fn(async () => ({
        columns: ["columnName", "dataType"],
        rows: [
          { columnName: "id", dataType: "INTEGER" },
          { columnName: "method", dataType: "TEXT" },
          { columnName: "amount", dataType: "REAL" }
        ]
      }))
    };
    const node = new RetrieveKnowledgeNode(
      { agentRagRetrievalEnabled: false } as never,
      queryExecutorRouter as never,
      {} as never
    );

    const result = await node.run({
      question: "有多少种支付方式，他们比例是如何",
      datasourceId: "ds-sqlite",
      datasource: {
        id: "ds-sqlite",
        name: "SQLite",
        type: "sqlite",
        status: "available",
        readonly: true,
        shared: true,
        config: { path: "/tmp/text2sql.db" },
        fileMeta: null,
        unavailableAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      runId: "run-schema-supplement",
      allowedTables: ["orders", "payments", "customers"]
    });

    expect(queryExecutorRouter.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("pragma_table_info('payments')")
      })
    );
    expect(result.retrievalBundle?.selected_context).toEqual([
      expect.objectContaining({
        chunk_id: "schema-supplement:ds-sqlite:payments",
        metadata: expect.objectContaining({
          tableNames: ["payments"],
          columnNames: ["payments.id", "payments.method", "payments.amount"]
        })
      })
    ]);
    expect(result.typedSummary.selectedContextCount).toBe(1);
    expect(result.evidenceRefs).toContain("schema-supplement:ds-sqlite:payments");
  });
});
