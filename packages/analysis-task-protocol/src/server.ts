import type { AnalysisEvent } from "./types";
import { assertAnalysisEvent } from "./validation";

export const serializeAnalysisEventSse = (event: AnalysisEvent): string => {
  const validated = assertAnalysisEvent(event);
  return `id: ${validated.sequence}\nevent: ${validated.type}\ndata: ${JSON.stringify(
    validated
  )}\n\n`;
};
