import type { AnalysisEvent, AnalysisTaskStatus } from "./types";
import { assertAnalysisEvent, isAnalysisTaskTerminalStatus } from "./validation";

export const parseAnalysisEventSseData = (data: string): AnalysisEvent =>
  assertAnalysisEvent(JSON.parse(data) as unknown);

export const mergeAnalysisEvents = (
  current: AnalysisEvent[],
  incoming: AnalysisEvent[]
): AnalysisEvent[] => {
  const bySequence = new Map(current.map((event) => [event.sequence, event]));
  for (const event of incoming) {
    const validated = assertAnalysisEvent(event);
    const existing = bySequence.get(validated.sequence);
    if (existing && existing.id !== validated.id) {
      throw new Error(`analysis event sequence conflict: ${validated.sequence}`);
    }
    bySequence.set(validated.sequence, validated);
  }
  return Array.from(bySequence.values()).sort(
    (left, right) => left.sequence - right.sequence
  );
};

export const transitionAnalysisTaskStatus = (
  current: AnalysisTaskStatus,
  incoming: AnalysisTaskStatus
): AnalysisTaskStatus => {
  if (isAnalysisTaskTerminalStatus(current)) {
    return current;
  }
  return incoming;
};
