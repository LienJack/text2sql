import { Injectable } from "@nestjs/common";
import { SqliteQueryService } from "../../data/sqlite/sqlite-query.service";

@Injectable()
export class ExecuteSqlNode {
  constructor(private readonly sqliteQuery: SqliteQueryService) {}

  async run(sql: string): Promise<{
    rows: Array<Record<string, unknown>>;
    columns: string[];
  }> {
    return this.sqliteQuery.query(sql);
  }
}

