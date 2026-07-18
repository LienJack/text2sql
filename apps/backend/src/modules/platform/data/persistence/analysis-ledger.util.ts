import { createHash } from "node:crypto";

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)])
    );
  }
  return value;
};

export const stableJson = (value: unknown): string => JSON.stringify(sortJson(value));

export const sha256Digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const toIso = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;
