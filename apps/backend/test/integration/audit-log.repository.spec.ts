import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { DataModule } from "../../src/modules/data/data.module";
import { AuditLogRepository } from "../../src/modules/data/persistence/audit-log.repository";

describe("audit log repository", () => {
  beforeAll(() => {
    process.env.SQLITE_PATH = resolve(
      __dirname,
      "../../../../data/sqlite/text2sql.db"
    );
    process.env.DATABASE_URL = "";
    process.env.REDIS_URL = "";
    process.env.LLM_PROVIDER = "volcengine";
    process.env.LLM_MOCK_MODE = "true";
  });

  it("persists and filters governance events", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DataModule]
    }).compile();
    const repository = moduleRef.get(AuditLogRepository);

    const created = await repository.appendEvent({
      phase: "governance",
      eventType: "workspace.datasource.binding.updated",
      eventCode: "BINDING_UPDATED",
      message: "已更新工作空间数据源绑定",
      metadata: {
        workspaceId: "workspace-audit-alpha",
        datasourceId: "ds-audit-sales"
      }
    });

    const runScoped = await repository.appendEvent({
      phase: "governance",
      eventType: "workspace.datasource.acl.denied",
      eventCode: "ACL_DENIED",
      message: "检测到未授权读表请求",
      runId: "run-audit-1",
      sessionId: "session-audit-1",
      severity: "warning",
      metadata: {
        tableName: "payroll",
        actorId: "user-audit-1"
      }
    });

    expect(created.id).toBeDefined();
    expect(runScoped.id).toBeDefined();

    const eventTypeList = await repository.listEvents({
      eventType: "workspace.datasource.binding.updated",
      limit: 10
    });
    expect(eventTypeList.some((item) => item.id === created.id)).toBe(true);
    expect(eventTypeList[0]?.eventType).toBe("workspace.datasource.binding.updated");

    const runScopedList = await repository.listEvents({
      runId: "run-audit-1",
      limit: 10
    });
    expect(runScopedList).toHaveLength(1);
    expect(runScopedList[0]?.id).toBe(runScoped.id);
    expect(runScopedList[0]?.metadata?.tableName).toBe("payroll");
  });
});
