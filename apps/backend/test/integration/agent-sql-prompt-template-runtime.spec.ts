import { Test } from "@nestjs/testing";
import type { LlmGatewayPrompt } from "../../src/modules/llm/llm-gateway.interface";
import { ProviderRouterService } from "../../src/modules/llm/provider-router.service";
import { GenerateSqlNode } from "../../src/modules/agent/nodes/generate-sql.node";
import { SqlGenerationService } from "../../src/modules/agent/sql/sql-generation.service";
import { SqlOutputExtractor } from "../../src/modules/agent/sql/sql-output-extractor";
import { SqlPromptBuilder } from "../../src/modules/agent/sql/sql-prompt.builder";
import { PromptTemplateService } from "../../src/modules/settings/prompt-template.service";

describe("agent sql prompt template runtime integration", () => {
  let generateSqlNode: GenerateSqlNode;
  let promptTemplateService: PromptTemplateService;
  let providerRouter: {
    generate: jest.Mock;
    stream: jest.Mock;
  };

  beforeEach(async () => {
    providerRouter = {
      generate: jest.fn(async (prompt: LlmGatewayPrompt) => ({
        provider: "mock-provider",
        model: "mock-model",
        rawText: [
          "这是 SQL 结果说明。",
          "```sql",
          "SELECT status, COUNT(*) AS cnt FROM orders GROUP BY status;",
          "```"
        ].join("\n"),
        prompt
      })),
      stream: jest.fn(async (prompt: LlmGatewayPrompt) => ({
        provider: "mock-provider",
        model: "mock-model",
        rawText: [
          "这是 SQL 流式结果说明。",
          "```sql",
          "SELECT payment_method, SUM(total_amount) FROM orders GROUP BY payment_method;",
          "```"
        ].join("\n"),
        prompt
      }))
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SqlPromptBuilder,
        SqlOutputExtractor,
        PromptTemplateService,
        SqlGenerationService,
        GenerateSqlNode,
        {
          provide: ProviderRouterService,
          useValue: providerRouter
        }
      ]
    }).compile();

    generateSqlNode = moduleRef.get(GenerateSqlNode);
    promptTemplateService = moduleRef.get(PromptTemplateService);
  });

  it("applies datasource > workspace > global priority for sync generation", async () => {
    const global = promptTemplateService.createTemplate(
      {
        name: "global-sql-template",
        scene: "sql",
        scope: "global",
        scopeKey: "global",
        content: "GLOBAL TEMPLATE",
        status: "active"
      },
      { id: "admin", role: "admin" }
    );
    const workspace = promptTemplateService.createTemplate(
      {
        name: "workspace-sql-template",
        scene: "sql",
        scope: "workspace",
        scopeKey: "ws_001",
        content: "WORKSPACE TEMPLATE",
        status: "active"
      },
      { id: "admin", role: "admin" }
    );
    const datasource = promptTemplateService.createTemplate(
      {
        name: "datasource-sql-template",
        scene: "sql",
        scope: "datasource",
        scopeKey: "ds_001",
        content: "DATASOURCE TEMPLATE",
        status: "active"
      },
      { id: "admin", role: "admin" }
    );

    const result = await generateSqlNode.run("统计订单状态分布", "sqlite", undefined, {
      datasourceId: "ds_001",
      workspaceId: "ws_001"
    });

    expect(providerRouter.generate).toHaveBeenCalledTimes(1);
    const prompt = providerRouter.generate.mock.calls[0][0] as LlmGatewayPrompt;
    expect(prompt.systemPrompt).toContain("DATASOURCE TEMPLATE");
    expect(prompt.systemPrompt).not.toContain("WORKSPACE TEMPLATE");
    expect(prompt.systemPrompt).not.toContain("GLOBAL TEMPLATE");
    expect(result.promptTemplate?.templateId).toBe(datasource.template.id);
    expect(result.promptTemplate?.scope).toBe("datasource");
    expect(result.promptTemplate?.version).toBe(datasource.template.version);
    expect(result.sql).toContain("SELECT status");
    expect(global.template.id).toBeDefined();
    expect(workspace.template.id).toBeDefined();
  });

  it("falls back to workspace then global when datasource template is absent", async () => {
    promptTemplateService.createTemplate(
      {
        name: "global-sql-template",
        scene: "sql",
        scope: "global",
        scopeKey: "global",
        content: "GLOBAL TEMPLATE",
        status: "active"
      },
      { id: "admin", role: "admin" }
    );
    const workspace = promptTemplateService.createTemplate(
      {
        name: "workspace-sql-template",
        scene: "sql",
        scope: "workspace",
        scopeKey: "ws_001",
        content: "WORKSPACE TEMPLATE",
        status: "active"
      },
      { id: "admin", role: "admin" }
    );

    const result = await generateSqlNode.run("统计订单状态分布", "sqlite", undefined, {
      datasourceId: "ds_not_exists",
      workspaceId: "ws_001"
    });

    const prompt = providerRouter.generate.mock.calls[0][0] as LlmGatewayPrompt;
    expect(prompt.systemPrompt).toContain("WORKSPACE TEMPLATE");
    expect(prompt.systemPrompt).not.toContain("GLOBAL TEMPLATE");
    expect(result.promptTemplate?.templateId).toBe(workspace.template.id);
    expect(result.promptTemplate?.scope).toBe("workspace");
  });

  it("keeps baseline prompt and marks fallback when template resolution fails", async () => {
    const resolveSpy = jest
      .spyOn(promptTemplateService, "resolveSqlTemplateRuntime")
      .mockRejectedValueOnce(new Error("template-service-down"));

    const result = await generateSqlNode.run("统计订单状态分布", "sqlite", undefined, {
      datasourceId: "ds_001",
      workspaceId: "ws_001"
    });

    const prompt = providerRouter.generate.mock.calls[0][0] as LlmGatewayPrompt;
    expect(prompt.systemPrompt).toContain("read-only SQL");
    expect(prompt.systemPrompt).not.toContain("Runtime template overlay");
    expect(result.promptTemplate?.fallbackReason).toBe("template_service_error");
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the same template matching for stream path", async () => {
    const datasource = promptTemplateService.createTemplate(
      {
        name: "datasource-stream-template",
        scene: "sql",
        scope: "datasource",
        scopeKey: "ds_stream",
        content: "STREAM DATASOURCE TEMPLATE",
        status: "active"
      },
      { id: "admin", role: "admin" }
    );

    const result = await generateSqlNode.run("统计支付方式交易额", "sqlite", undefined, {
      stream: true,
      datasourceId: "ds_stream",
      workspaceId: "ws_stream",
      onEvent: async () => {
        return;
      }
    });

    expect(providerRouter.stream).toHaveBeenCalledTimes(1);
    const prompt = providerRouter.stream.mock.calls[0][0] as LlmGatewayPrompt;
    expect(prompt.systemPrompt).toContain("STREAM DATASOURCE TEMPLATE");
    expect(result.promptTemplate?.templateId).toBe(datasource.template.id);
    expect(result.promptTemplate?.scope).toBe("datasource");
    expect(result.sql).toContain("SELECT payment_method");
  });
});
