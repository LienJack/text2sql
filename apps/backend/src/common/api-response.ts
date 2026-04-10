import type { ApiFailure, ApiSuccess } from "@text2sql/shared-types";

export const ok = <T>(requestId: string, data: T): ApiSuccess<T> => ({
  status: "success",
  requestId,
  data
});

export const fail = (
  requestId: string,
  code: string,
  message: string,
  details?: Record<string, unknown>
): ApiFailure => ({
  status: "error",
  requestId,
  error: {
    code,
    message,
    details
  }
});

