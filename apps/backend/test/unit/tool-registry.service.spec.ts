import { SqlReadonlyTool } from "../../src/modules/agent/sql/tools/sql-readonly.tool";
import { SqlToolRegistryService } from "../../src/modules/agent/sql/tools/sql-tool-registry.service";

describe("SqlToolRegistryService", () => {
  it("should expose read-only sql tool", async () => {
    const queryExecutorRouter = {
      execute: jest.fn(async () => ({
        rows: [{ status: "paid", order_count: 3 }],
        columns: ["status", "order_count"]
      }))
    };
    const datasourceAccessPolicyService = {
      resolveReadableTables: jest.fn(async () => ({
        datasourceId: "sqlite_main",
        readableTables: ["orders"],
        decisions: {
          orders: "role_allow"
        }
      }))
    };
    const sqlTool = new SqlReadonlyTool(
      queryExecutorRouter as never,
      datasourceAccessPolicyService as never
    );
    const registry = new SqlToolRegistryService(sqlTool);

    const tools = registry.getToolsForDatasource({
      id: "sqlite_main",
      name: "SQLite 主数据源",
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
    });
    expect(tools.runReadOnlySql).toBeTruthy();

    const result = await tools.runReadOnlySql.execute({
      sql: "SELECT status, COUNT(*) AS order_count FROM orders GROUP BY status"
    });
    expect(queryExecutorRouter.execute).toHaveBeenCalled();
    expect(result).toMatchObject({
      rowCount: 1
    });
  });
});
