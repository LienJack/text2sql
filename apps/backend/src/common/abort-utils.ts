import { DomainError } from "./domain-error";

export const USER_CANCELLED_CODE = "USER_CANCELLED";
export const USER_CANCELLED_MESSAGE = "用户已停止本轮生成。";

export function createUserCancelledError(details?: Record<string, unknown>): DomainError {
  return new DomainError(USER_CANCELLED_CODE, USER_CANCELLED_MESSAGE, 499, details);
}

export function isUserCancelledError(error: unknown): error is DomainError {
  return error instanceof DomainError && error.code === USER_CANCELLED_CODE;
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  details?: Record<string, unknown>
): void {
  if (!signal?.aborted) {
    return;
  }
  throw createUserCancelledError(details);
}

export function composeAbortSignals(
  signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) {
    return undefined;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }

  const controller = new AbortController();
  const cleanupCallbacks: Array<() => void> = [];

  const abortFrom = (signal: AbortSignal) => {
    cleanupCallbacks.splice(0).forEach((cleanup) => cleanup());
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      return controller.signal;
    }
    const handleAbort = () => abortFrom(signal);
    signal.addEventListener("abort", handleAbort, { once: true });
    cleanupCallbacks.push(() => signal.removeEventListener("abort", handleAbort));
  }

  return controller.signal;
}
