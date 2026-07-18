import { createHash } from "node:crypto";
import { Injectable, Optional } from "@nestjs/common";
import type {
  DatasourceType,
  Text2SqlAccuracyGateReceiptV1,
  Text2SqlEvalVersionTupleV1,
  Text2SqlExecutionPermitReceiptV1,
  Text2SqlExecutionReceiptV1
} from "@text2sql/shared-types";
import { DomainError } from "../../../../common/domain-error";
import { AppConfigService } from "../../../config/app-config.service";
import {
  createText2SqlAccuracyGateReceipt,
  createText2SqlExecutionPermitReceipt,
  createText2SqlExecutionReceipt
} from "../../accuracy/text2sql-accuracy-receipt.factory";
import type {
  QueryExecutionResult,
  QueryExplainResult
} from "../../../data/query/query-executor.interface";
import {
  SqlTableAccessGuardService,
  type SqlTableAccessContext
} from "../../../data/query/sql-table-access-guard.service";
import { SqlDialectAnalyzerService } from "../sql-analysis/sql-dialect-analyzer.service";

export interface BoundedQueryExecutionLimits {
  timeoutMs: number;
  maxRows: number;
  maxBytes: number;
  maxAstNodes: number;
}

export interface BoundedQueryExecutionInput {
  runId: string;
  datasourceId: string;
  datasourceType: DatasourceType;
  sql: string;
  queryContractDigest: string;
  versions: Text2SqlEvalVersionTupleV1;
  gateReceipts: Text2SqlAccuracyGateReceiptV1[];
  accessContext?: SqlTableAccessContext;
  allowedTables?: Iterable<string>;
  abortSignal?: AbortSignal;
  limits?: Partial<BoundedQueryExecutionLimits>;
  requireExplain?: boolean;
  preflight?: (input: {
    sql: string;
    abortSignal?: AbortSignal;
    timeoutMs: number;
  }) => Promise<QueryExplainResult>;
  execute: (input: {
    sql: string;
    abortSignal: AbortSignal;
    timeoutMs: number;
  }) => Promise<QueryExecutionResult>;
}

export interface BoundedQueryExecutionResult extends QueryExecutionResult {
  rowCount: number;
  byteCount: number;
  resourceGateReceipt: Text2SqlAccuracyGateReceiptV1;
  sandboxGateReceipt: Text2SqlAccuracyGateReceiptV1;
  executionPermit: Text2SqlExecutionPermitReceiptV1;
  executionReceipt: Text2SqlExecutionReceiptV1;
}

const DEFAULT_LIMITS: BoundedQueryExecutionLimits = {
  timeoutMs: 10_000,
  maxRows: 200,
  maxBytes: 2 * 1024 * 1024,
  maxAstNodes: 20_000
};

@Injectable()
export class BoundedQueryExecutionService {
  constructor(
    private readonly sqlAnalyzer: SqlDialectAnalyzerService = new SqlDialectAnalyzerService(),
    private readonly tableAccessGuard: SqlTableAccessGuardService = new SqlTableAccessGuardService(),
    @Optional()
    private readonly appConfig?: AppConfigService
  ) {}

  async execute(input: BoundedQueryExecutionInput): Promise<BoundedQueryExecutionResult> {
    const limits = {
      ...DEFAULT_LIMITS,
      ...(this.appConfig
        ? {
            timeoutMs: this.appConfig.text2sqlExecutionTimeoutMs,
            maxRows: this.appConfig.text2sqlExecutionMaxRows,
            maxBytes: this.appConfig.text2sqlExecutionMaxBytes,
            maxAstNodes: this.appConfig.text2sqlExecutionMaxAstNodes
          }
        : {}),
      ...input.limits
    };
    const analysis = this.sqlAnalyzer.analyze({
      sql: input.sql,
      datasourceType: input.datasourceType,
      budget: { maxAstNodes: limits.maxAstNodes }
    });
    const sqlDigest = analysis.normalizedSqlDigest;
    const issuedAt = new Date().toISOString();
    const binding = {
      runId: input.runId,
      queryContractDigest: input.queryContractDigest,
      sqlDigest,
      versions: input.versions
    };
    const parentReceiptDigests = input.gateReceipts.map((receipt) => receipt.receiptDigest);
    let explainResult: QueryExplainResult | undefined;
    let explainFailed = false;
    if (input.preflight) {
      try {
        explainResult = await input.preflight({
          sql: input.sql,
          abortSignal: input.abortSignal,
          timeoutMs: limits.timeoutMs
        });
      } catch {
        explainFailed = true;
      }
    }
    const dialectCapability =
      input.datasourceType !== "csv" && input.datasourceType !== "excel";
    const explainCapability =
      !input.requireExplain || explainResult?.capability === "available";
    const resourceCapability = dialectCapability && explainCapability;
    const resourceReady =
      resourceCapability &&
      !explainFailed &&
      analysis.status === "ready" &&
      analysis.readOnly &&
      analysis.astNodeCount <= limits.maxAstNodes;
    const resourceGateReceipt = createText2SqlAccuracyGateReceipt({
      ...binding,
      gate: "resource",
      status: resourceReady
        ? "passed"
        : resourceCapability
          ? "failed"
          : "unavailable",
      capability: resourceCapability ? "available" : "unavailable",
      reasonCodes: resourceReady
        ? [
            "resource_preflight_passed",
            "ast_budget_passed",
            ...(explainResult?.reasonCodes ?? ["explain_compatibility_path"])
          ]
        : [
            ...(explainFailed ? ["explain_preflight_failed"] : []),
            ...(input.requireExplain && !input.preflight
              ? ["explain_capability_unavailable"]
              : []),
            ...(explainResult?.reasonCodes ?? []),
            ...(analysis.diagnostics.length > 0
              ? analysis.diagnostics.map((diagnostic) => diagnostic.code)
              : ["resource_capability_unavailable"])
          ],
      evidenceRefs: [
        `sql-analysis:${analysis.normalizedSqlDigest}`,
        `ast-nodes:${analysis.astNodeCount}`,
        ...(explainResult?.evidenceRefs ?? [])
      ],
      parentReceiptDigests,
      issuedAt
    });
    if (!resourceReady) {
      throw new DomainError(
        "SQL_RESOURCE_GATE_UNAVAILABLE",
        "SQL resource preflight is unavailable or exceeded its budget.",
        422,
        { resourceGateReceipt }
      );
    }

    let guardedSql = input.sql;
    if (input.accessContext) {
      this.tableAccessGuard.assertReadOnlySql(input.sql, input.datasourceType);
      const guarded = await this.tableAccessGuard.assertTableAccess({
        sql: input.sql,
        datasourceId: input.datasourceId,
        datasourceType: input.datasourceType,
        accessContext: input.accessContext,
        allowedTables: input.allowedTables
      });
      guardedSql = guarded.sql;
      if (this.normalizeSql(guardedSql) !== this.normalizeSql(input.sql)) {
        throw new DomainError(
          "SQL_BOUNDED_REWRITE_REQUIRES_REVALIDATION",
          "Execution-boundary policy rewrote SQL; a new validation receipt is required.",
          422,
          { reasonCode: "row_filter_rewrite_changed_sql" }
        );
      }
    }

    const executionPermit = createText2SqlExecutionPermitReceipt({
      ...binding,
      gateReceipts: [...input.gateReceipts, resourceGateReceipt],
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + Math.max(1_000, limits.timeoutMs * 2)).toISOString()
    });
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(input.abortSignal?.reason);
    input.abortSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("SQL_EXECUTION_TIMEOUT")),
      limits.timeoutMs
    );
    const startedAt = new Date().toISOString();

    try {
      if (input.abortSignal?.aborted) {
        controller.abort(input.abortSignal.reason);
      }
      const result = await this.runWithAbort(
        input.execute({
          sql: guardedSql,
          abortSignal: controller.signal,
          timeoutMs: limits.timeoutMs
        }),
        controller.signal
      );
      const rowCount = result.rows.length;
      const byteCount = Buffer.byteLength(JSON.stringify(result.rows), "utf8");
      if (rowCount > limits.maxRows || byteCount > limits.maxBytes) {
        controller.abort(new Error("SQL_EXECUTION_RESULT_CAP_EXCEEDED"));
        return this.throwFailedExecution({
          binding,
          executionPermit,
          limits,
          startedAt,
          reasonCode:
            rowCount > limits.maxRows
              ? "execution_row_cap_exceeded"
              : "execution_byte_cap_exceeded",
          cancelled: true,
          resourceGateReceipt
        });
      }
      const completedAt = new Date().toISOString();
      const resultDigest = this.hash(JSON.stringify(this.stableValue(result.rows)));
      const sandboxGateReceipt = createText2SqlAccuracyGateReceipt({
        ...binding,
        gate: "sandbox",
        status: "passed",
        capability: "available",
        reasonCodes: ["bounded_execution_passed", "partial_output_absent"],
        evidenceRefs: [`result:${resultDigest}`],
        parentReceiptDigests: [executionPermit.receiptDigest],
        issuedAt: completedAt
      });
      const executionReceipt = createText2SqlExecutionReceipt({
        permit: executionPermit,
        sandboxGateReceipt,
        status: "passed",
        readOnlyEnforced: true,
        authorizationRechecked: Boolean(input.accessContext),
        timeoutMs: limits.timeoutMs,
        cancelled: false,
        rowCount,
        byteCount,
        resultDigest,
        reasonCodes: ["bounded_execution_passed"],
        startedAt,
        completedAt
      });
      return {
        ...result,
        rowCount,
        byteCount,
        resourceGateReceipt,
        sandboxGateReceipt,
        executionPermit,
        executionReceipt
      };
    } catch (error) {
      if (error instanceof DomainError && error.code === "SQL_BOUNDED_EXECUTION_FAILED") {
        throw error;
      }
      const aborted = controller.signal.aborted;
      return this.throwFailedExecution({
        binding,
        executionPermit,
        limits,
        startedAt,
        reasonCode: aborted
          ? input.abortSignal?.aborted
            ? "user_cancelled"
            : "execution_timeout"
          : "execution_failed",
        cancelled: aborted,
        resourceGateReceipt,
        cause: error
      });
    } finally {
      clearTimeout(timeout);
      input.abortSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  private throwFailedExecution(input: {
    binding: {
      runId: string;
      queryContractDigest: string;
      sqlDigest: string;
      versions: Text2SqlEvalVersionTupleV1;
    };
    executionPermit: Text2SqlExecutionPermitReceiptV1;
    resourceGateReceipt: Text2SqlAccuracyGateReceiptV1;
    limits: BoundedQueryExecutionLimits;
    startedAt: string;
    reasonCode: string;
    cancelled: boolean;
    cause?: unknown;
  }): never {
    const completedAt = new Date().toISOString();
    const sandboxGateReceipt = createText2SqlAccuracyGateReceipt({
      ...input.binding,
      gate: "sandbox",
      status: "failed",
      capability: "available",
      reasonCodes: [input.reasonCode],
      evidenceRefs: [],
      parentReceiptDigests: [input.executionPermit.receiptDigest],
      issuedAt: completedAt
    });
    const executionReceipt = createText2SqlExecutionReceipt({
      permit: input.executionPermit,
      sandboxGateReceipt,
      status: "failed",
      readOnlyEnforced: true,
      authorizationRechecked: true,
      timeoutMs: input.limits.timeoutMs,
      cancelled: input.cancelled,
      rowCount: 0,
      byteCount: 0,
      reasonCodes: [input.reasonCode, "partial_output_discarded"],
      startedAt: input.startedAt,
      completedAt
    });
    throw new DomainError(
      "SQL_BOUNDED_EXECUTION_FAILED",
      "Bounded SQL execution failed; partial output was discarded.",
      input.cancelled ? 408 : 422,
      {
        reasonCode: input.reasonCode,
        resourceGateReceipt: input.resourceGateReceipt,
        sandboxGateReceipt,
        executionPermit: input.executionPermit,
        executionReceipt,
        causeCode:
          input.cause instanceof DomainError
            ? input.cause.code
            : input.cause instanceof Error
              ? input.cause.name
              : undefined
      }
    );
  }

  private runWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(signal.reason ?? new Error("aborted"));
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason ?? new Error("aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  private normalizeSql(sql: string): string {
    return sql.trim().replace(/;+\s*$/, "").replace(/\s+/g, " ");
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private stableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.stableValue(item));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, this.stableValue(item)])
      );
    }
    return value;
  }
}
