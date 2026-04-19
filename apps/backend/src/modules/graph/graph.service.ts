import { Injectable, Logger } from "@nestjs/common";
import {
  GraphAccelerationAdapter,
  GraphAccelerationError,
  GraphAccelerationTimeoutError,
  GraphAccelerationUnsupportedOperatorError
} from "./adapter/graph-acceleration.adapter";
import {
  GraphAccelerationCircuitBreaker,
  type GraphAccelerationBreakerFallback
} from "./adapter/graph-acceleration-circuit-breaker";
import type {
  RagRetrievalEntryContext,
  RagRetrievalLaneHit
} from "../knowledge/rag/retrieval/rag-retrieval.types";

export interface GraphLaneExecutionInput {
  query: string;
  contexts: RagRetrievalEntryContext[];
  limit: number;
  fallbackRunner: () => RagRetrievalLaneHit[];
}

export interface GraphLaneExecutionResult {
  hits: RagRetrievalLaneHit[];
  degradeReason?: string;
}

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    private readonly accelerationAdapter: GraphAccelerationAdapter,
    private readonly breaker: GraphAccelerationCircuitBreaker
  ) {}

  async runLane(input: GraphLaneExecutionInput): Promise<GraphLaneExecutionResult> {
    if (!this.isAccelerationEnabled()) {
      return {
        hits: input.fallbackRunner().slice(0, input.limit)
      };
    }

    const breakerGuard = this.breaker.guard();
    if (!breakerGuard.allowed) {
      return this.fallback(input, breakerGuard.fallback);
    }

    try {
      const startedAt = Date.now();
      const hits = await this.accelerationAdapter.execute({
        query: input.query,
        contexts: input.contexts,
        limit: input.limit
      });
      const elapsedMs = Date.now() - startedAt;
      const latencyFallback = this.breaker.recordLatency(elapsedMs);
      if (latencyFallback) {
        this.breaker.recordSuccess();
        return this.fallback(input, latencyFallback);
      }
      this.breaker.recordSuccess();
      return {
        hits
      };
    } catch (error) {
      const fallbackReason = this.toFallbackReason(error);
      const openFallback = this.breaker.recordFailure(
        error instanceof GraphAccelerationTimeoutError ? "timeout" : "error"
      );
      return this.fallback(input, {
        reason: openFallback?.reason ?? fallbackReason,
        source: openFallback ? "breaker_open" : "adapter_error",
        openedAt: openFallback?.openedAt,
        openForMs: openFallback?.openForMs,
        recoveryCondition:
          openFallback?.recoveryCondition ??
          "fix graph acceleration errors and wait breaker cooldown if opened",
        impactScope: "retrieval_graph_lane"
      });
    }
  }

  private fallback(
    input: GraphLaneExecutionInput,
    fallback: GraphAccelerationBreakerFallback
  ): GraphLaneExecutionResult {
    const hits = input.fallbackRunner().slice(0, input.limit);
    this.logger.warn(
      JSON.stringify({
        event: "graph_acceleration_fallback",
        at: new Date().toISOString(),
        reason: fallback.reason,
        source: fallback.source,
        openedAt: fallback.openedAt,
        openForMs: fallback.openForMs,
        recoveryCondition: fallback.recoveryCondition,
        impactScope: fallback.impactScope
      })
    );
    return {
      hits,
      degradeReason: fallback.reason
    };
  }

  private isAccelerationEnabled(): boolean {
    return process.env.GRAPH_ACCELERATION_ENABLED === "true";
  }

  private toFallbackReason(error: unknown): string {
    if (error instanceof GraphAccelerationTimeoutError) {
      return "graph_acceleration_timeout_fallback";
    }
    if (error instanceof GraphAccelerationUnsupportedOperatorError) {
      return "graph_acceleration_unsupported_operator_fallback";
    }
    if (error instanceof GraphAccelerationError) {
      return "graph_acceleration_error_fallback";
    }
    return `graph_acceleration_unknown_fallback:${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}
