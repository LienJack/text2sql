import { Injectable } from "@nestjs/common";

type GraphAccelerationBreakerReason =
  | "consecutive_failures"
  | "timeout_rate"
  | "latency_degradation";

type GraphAccelerationFailureKind = "error" | "timeout";

interface BreakerSample {
  timeout: boolean;
  latencyDegraded: boolean;
}

export interface GraphAccelerationBreakerFallback {
  reason: string;
  source: "forced_postgres_only" | "breaker_open" | "adapter_error";
  openedAt?: string;
  openForMs?: number;
  recoveryCondition: string;
  impactScope: "retrieval_graph_lane";
}

@Injectable()
export class GraphAccelerationCircuitBreaker {
  private readonly failureThreshold = this.readPositiveInt(
    process.env.GRAPH_ACCELERATION_BREAKER_FAILURE_THRESHOLD,
    3
  );
  private readonly openMs = this.readPositiveInt(
    process.env.GRAPH_ACCELERATION_BREAKER_OPEN_MS,
    60_000
  );
  private readonly timeoutRateThreshold = this.readRatio(
    process.env.GRAPH_ACCELERATION_TIMEOUT_RATE_THRESHOLD,
    0.5
  );
  private readonly timeoutRateWindowSize = this.readPositiveInt(
    process.env.GRAPH_ACCELERATION_TIMEOUT_RATE_WINDOW,
    12
  );
  private readonly timeoutRateMinSamples = this.readPositiveInt(
    process.env.GRAPH_ACCELERATION_TIMEOUT_RATE_MIN_SAMPLES,
    4
  );
  private readonly latencyDegradeThresholdMs = this.readPositiveInt(
    process.env.GRAPH_ACCELERATION_LATENCY_DEGRADE_THRESHOLD_MS,
    450
  );
  private readonly latencyDegradeMinSamples = this.readPositiveInt(
    process.env.GRAPH_ACCELERATION_LATENCY_DEGRADE_MIN_SAMPLES,
    3
  );
  private readonly forcedPostgresOnly =
    process.env.GRAPH_ACCELERATION_FORCE_POSTGRES_ONLY === "true";

  private consecutiveFailures = 0;
  private readonly recentSamples: BreakerSample[] = [];
  private openUntilMs = 0;
  private openedAtIso?: string;
  private openReason?: GraphAccelerationBreakerReason;

  guard(): { allowed: true } | { allowed: false; fallback: GraphAccelerationBreakerFallback } {
    if (this.forcedPostgresOnly) {
      return {
        allowed: false,
        fallback: {
          reason: "graph_acceleration_forced_postgres_only",
          source: "forced_postgres_only",
          recoveryCondition: "set GRAPH_ACCELERATION_FORCE_POSTGRES_ONLY=false",
          impactScope: "retrieval_graph_lane"
        }
      };
    }

    const now = Date.now();
    if (this.openUntilMs > now) {
      const openForMs = Math.max(0, this.openUntilMs - now);
      return {
        allowed: false,
        fallback: {
          reason: `graph_acceleration_breaker_open_${this.openReason ?? "unknown"}`,
          source: "breaker_open",
          openedAt: this.openedAtIso,
          openForMs,
          recoveryCondition:
            "wait breaker cooldown window and ensure error/timeout/latency signals recover",
          impactScope: "retrieval_graph_lane"
        }
      };
    }

    if (this.openUntilMs > 0 && this.openUntilMs <= now) {
      this.resetOpenState();
    }

    return { allowed: true };
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.pushSample({
      timeout: false,
      latencyDegraded: false
    });
  }

  recordFailure(kind: GraphAccelerationFailureKind): GraphAccelerationBreakerFallback | undefined {
    this.consecutiveFailures += 1;
    this.pushSample({
      timeout: kind === "timeout",
      latencyDegraded: false
    });

    if (this.consecutiveFailures >= this.failureThreshold) {
      return this.open("consecutive_failures");
    }

    if (this.shouldOpenByTimeoutRate()) {
      return this.open("timeout_rate");
    }

    return undefined;
  }

  recordLatency(elapsedMs: number): GraphAccelerationBreakerFallback | undefined {
    const degraded = elapsedMs > this.latencyDegradeThresholdMs;
    this.pushSample({
      timeout: false,
      latencyDegraded: degraded
    });
    if (!degraded) {
      return undefined;
    }
    if (this.shouldOpenByLatencyDegradation()) {
      return this.open("latency_degradation");
    }
    return undefined;
  }

  private shouldOpenByLatencyDegradation(): boolean {
    if (this.recentSamples.length < this.latencyDegradeMinSamples) {
      return false;
    }
    return this.recentSamples.every((sample) => sample.latencyDegraded);
  }

  private shouldOpenByTimeoutRate(): boolean {
    if (this.recentSamples.length < this.timeoutRateMinSamples) {
      return false;
    }
    const timeoutCount = this.recentSamples.filter((sample) => sample.timeout).length;
    const timeoutRate = timeoutCount / this.recentSamples.length;
    return timeoutRate >= this.timeoutRateThreshold;
  }

  private open(reason: GraphAccelerationBreakerReason): GraphAccelerationBreakerFallback {
    const now = Date.now();
    this.openUntilMs = now + this.openMs;
    this.openedAtIso = new Date(now).toISOString();
    this.openReason = reason;
    this.consecutiveFailures = 0;
    return {
      reason: `graph_acceleration_breaker_open_${reason}`,
      source: "breaker_open",
      openedAt: this.openedAtIso,
      openForMs: this.openMs,
      recoveryCondition:
        "wait breaker cooldown window and ensure error/timeout/latency signals recover",
      impactScope: "retrieval_graph_lane"
    };
  }

  private resetOpenState(): void {
    this.openUntilMs = 0;
    this.openedAtIso = undefined;
    this.openReason = undefined;
    this.recentSamples.length = 0;
    this.consecutiveFailures = 0;
  }

  private pushSample(sample: BreakerSample): void {
    this.recentSamples.push(sample);
    if (this.recentSamples.length > this.timeoutRateWindowSize) {
      this.recentSamples.shift();
    }
  }

  private readPositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  private readRatio(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(0, Math.min(1, parsed));
  }
}
