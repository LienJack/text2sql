import { Injectable } from "@nestjs/common";
import {
  SqlSafetyGuard,
  type SqlSafetyDecision
} from "../sql/tools/sql-safety.guard";

@Injectable()
export class SafetyCheckNode {
  constructor(private readonly sqlSafetyGuard: SqlSafetyGuard) {}

  run(sql: string): SqlSafetyDecision {
    return this.sqlSafetyGuard.evaluate(sql);
  }
}
