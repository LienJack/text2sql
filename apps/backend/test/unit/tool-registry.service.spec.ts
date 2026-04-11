import { SqlReadonlyTool } from "../../src/modules/agent/sql/tools/sql-readonly.tool";
import { SqlSafetyGuard } from "../../src/modules/agent/sql/tools/sql-safety.guard";
import { SqlToolRegistryService } from "../../src/modules/agent/sql/tools/sql-tool-registry.service";

describe("SqlToolRegistryService", () => {
  it("should expose read-only sql tool", async () => {
    const sqliteQuery = {
      query: jest.fn(async () => ({
        rows: [{ status: "paid", order_count: 3 }],
        columns: ["status", "order_count"]
      }))
    };
    const guard = new SqlSafetyGuard();
    const sqlTool = new SqlReadonlyTool(sqliteQuery as never, guard);
    const registry = new SqlToolRegistryService(sqlTool);

    const tools = registry.getTools();
    expect(tools.runReadOnlySql).toBeTruthy();

    const result = await tools.runReadOnlySql.execute({
      sql: "SELECT status, COUNT(*) AS order_count FROM orders GROUP BY status"
    });
    expect(sqliteQuery.query).toHaveBeenCalled();
    expect(result).toMatchObject({
      rowCount: 1
    });
  });
});
