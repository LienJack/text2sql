import { SqlReadonlyTool } from "../../src/modules/llm/tools/sql-readonly.tool";
import { ToolExecutionGuard } from "../../src/modules/llm/tools/tool-execution-guard";
import { ToolRegistryService } from "../../src/modules/llm/tools/tool-registry.service";

describe("ToolRegistryService", () => {
  it("should expose read-only sql tool", async () => {
    const sqliteQuery = {
      query: jest.fn(async () => ({
        rows: [{ status: "paid", order_count: 3 }],
        columns: ["status", "order_count"]
      }))
    };
    const guard = new ToolExecutionGuard();
    const sqlTool = new SqlReadonlyTool(sqliteQuery as never, guard);
    const registry = new ToolRegistryService(sqlTool);

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
