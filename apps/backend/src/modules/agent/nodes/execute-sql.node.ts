import { Injectable } from "@nestjs/common";
import { DomainError } from "../../../common/domain-error";
import { QueryExecutorRouterService } from "../../data/query/query-executor-router.service";
import { DatasourceService } from "../../datasource/datasource.service";

@Injectable()
export class ExecuteSqlNode {
  constructor(
    private readonly datasourceService: DatasourceService,
    private readonly queryExecutorRouter: QueryExecutorRouterService
  ) {}

  async run(input: {
    sql: string;
    datasourceId: string;
  }): Promise<{
    rows: Array<Record<string, unknown>>;
    columns: string[];
  }> {
    const datasource = await this.datasourceService.getDatasourceById(
      input.datasourceId
    );
    if (!datasource) {
      throw new DomainError("DATASOURCE_NOT_FOUND", "会话绑定的数据源不存在", 404, {
        datasourceId: input.datasourceId
      });
    }

    if (datasource.status !== "available") {
      throw new DomainError(
        "DATASOURCE_UNAVAILABLE",
        "当前会话绑定的数据源不可用，请先重新选择数据源。",
        409,
        {
          datasourceId: input.datasourceId,
          status: datasource.status
        }
      );
    }

    return this.queryExecutorRouter.execute({
      datasource,
      sql: input.sql
    });
  }
}
