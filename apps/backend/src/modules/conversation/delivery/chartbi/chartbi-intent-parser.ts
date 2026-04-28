import { Injectable } from "@nestjs/common";
import {
  CHARTBI_DISPLAY_ALLOWLIST,
  type ChartBiDisplayType,
  type ChartBiFieldMappings
} from "./chartbi-result-profiler";

export interface ChartBiVisualIntent {
  type?: ChartBiDisplayType;
  mappings: ChartBiFieldMappings;
  title?: string;
  insights?: string[];
}

export type ChartBiIntentParseResult =
  | {
      status: "not_provided";
    }
  | {
      status: "failed";
      reason: string;
      raw: string;
    }
  | {
      status: "parsed";
      source: "json" | "vis";
      raw: string;
      normalized: string;
      intent: ChartBiVisualIntent;
    };

@Injectable()
export class ChartBiIntentParser {
  parse(rawInput: string | null | undefined): ChartBiIntentParseResult {
    if (typeof rawInput !== "string" || rawInput.trim().length === 0) {
      return {
        status: "not_provided"
      };
    }

    const raw = rawInput.trim();
    const candidates = this.collectCandidates(raw);

    for (const candidate of candidates) {
      const jsonResult = this.tryParseJson(candidate);
      if (jsonResult) {
        return {
          status: "parsed",
          source: "json",
          raw,
          normalized: jsonResult.normalized,
          intent: jsonResult.intent
        };
      }

      const visResult = this.tryParseVis(candidate);
      if (visResult) {
        return {
          status: "parsed",
          source: "vis",
          raw,
          normalized: visResult.normalized,
          intent: visResult.intent
        };
      }
    }

    return {
      status: "failed",
      raw,
      reason: "Unable to parse visual intent payload from model output."
    };
  }

  private collectCandidates(raw: string): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();

    const push = (value: string | undefined): void => {
      if (!value) {
        return;
      }
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      candidates.push(normalized);
    };

    const fencedPreferred: string[] = [];
    const fencedFallback: string[] = [];
    const fencedRegex = /```([a-zA-Z0-9_-]*)?\s*([\s\S]*?)```/g;
    let fencedMatch: RegExpExecArray | null = fencedRegex.exec(raw);
    while (fencedMatch) {
      const language = (fencedMatch[1] ?? "").toLowerCase();
      const body = (fencedMatch[2] ?? "").trim();
      if (body) {
        if (language.includes("json") || language.includes("vis")) {
          fencedPreferred.push(body);
        } else {
          fencedFallback.push(body);
        }
      }
      fencedMatch = fencedRegex.exec(raw);
    }

    for (const candidate of [...fencedPreferred, ...fencedFallback]) {
      push(candidate);
    }

    push(this.extractJsonObject(raw));

    const visualIntentLabelMatch = raw.match(/visualIntent\s*[:=]\s*([\s\S]+)/i);
    push(visualIntentLabelMatch?.[1]);

    push(raw);

    return candidates;
  }

  private tryParseJson(input: string):
    | {
        normalized: string;
        intent: ChartBiVisualIntent;
      }
    | undefined {
    const normalized = input.replace(/^json\s*/i, "").trim();
    const jsonCandidate = this.extractJsonObject(normalized) ?? normalized;
    if (!jsonCandidate.startsWith("{") || !jsonCandidate.endsWith("}")) {
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonCandidate);
    } catch {
      return undefined;
    }

    if (!this.isRecord(parsed)) {
      return undefined;
    }

    const payload =
      this.isRecord(parsed.visualIntent) || this.isRecord(parsed.chart)
        ? (this.isRecord(parsed.visualIntent)
            ? parsed.visualIntent
            : (parsed.chart as Record<string, unknown>))
        : parsed;

    const intent = this.objectToIntent(payload);
    if (!intent) {
      return undefined;
    }

    return {
      normalized: jsonCandidate,
      intent
    };
  }

  private tryParseVis(input: string):
    | {
        normalized: string;
        intent: ChartBiVisualIntent;
      }
    | undefined {
    const normalized = input.replace(/^vis(?:ual)?\s*[:\-]?\s*/i, "").trim();
    if (!normalized) {
      return undefined;
    }

    const keyValues = this.readVisKeyValues(normalized);
    const firstToken = normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .find((token) => token.length > 0);

    const type = this.normalizeType(
      keyValues.get("type") ??
        keyValues.get("chart") ??
        keyValues.get("mark") ??
        firstToken
    );

    const mappings: ChartBiFieldMappings = {
      x: keyValues.get("x") ?? keyValues.get("xfield"),
      y: keyValues.get("y") ?? keyValues.get("yfield"),
      dimension: keyValues.get("dimension") ?? keyValues.get("dim"),
      measure:
        keyValues.get("measure") ??
        keyValues.get("metric") ??
        keyValues.get("valuefield"),
      time: keyValues.get("time") ?? keyValues.get("date"),
      category: keyValues.get("category"),
      value: keyValues.get("value")
    };

    const title = keyValues.get("title");
    const insights = this.splitInsights(
      keyValues.get("insight") ?? keyValues.get("insights")
    );

    if (!type && !this.hasAnyMapping(mappings) && !title && insights.length === 0) {
      return undefined;
    }

    return {
      normalized,
      intent: {
        type,
        mappings,
        ...(title ? { title } : {}),
        ...(insights.length > 0 ? { insights } : {})
      }
    };
  }

  private objectToIntent(payload: Record<string, unknown>): ChartBiVisualIntent | undefined {
    const mappingsRecord = this.isRecord(payload.mappings)
      ? payload.mappings
      : undefined;

    const type = this.normalizeType(
      payload.type ??
        payload.chartType ??
        payload.chart_type ??
        payload.mark ??
        payload.chart ??
        payload.display
    );

    const mappings: ChartBiFieldMappings = {
      x: this.readString(
        payload.x ??
          payload.xField ??
          payload.x_field ??
          mappingsRecord?.x ??
          mappingsRecord?.xField
      ),
      y: this.readString(
        payload.y ??
          payload.yField ??
          payload.y_field ??
          mappingsRecord?.y ??
          mappingsRecord?.yField
      ),
      dimension: this.readString(
        payload.dimension ??
          payload.groupBy ??
          payload.group_by ??
          mappingsRecord?.dimension ??
          mappingsRecord?.groupBy
      ),
      measure: this.readString(
        payload.measure ??
          payload.metric ??
          payload.measureField ??
          payload.measure_field ??
          mappingsRecord?.measure ??
          mappingsRecord?.metric
      ),
      time: this.readString(
        payload.time ?? payload.timeField ?? payload.time_field ?? mappingsRecord?.time
      ),
      category: this.readString(
        payload.category ?? payload.categoryField ?? mappingsRecord?.category
      ),
      value: this.readString(
        payload.value ?? payload.valueField ?? payload.value_field ?? mappingsRecord?.value
      )
    };

    const title = this.readString(payload.title ?? payload.name ?? payload.label);
    const insights = this.readStringArray(payload.insights ?? payload.insight);

    if (!type && !this.hasAnyMapping(mappings) && !title && insights.length === 0) {
      return undefined;
    }

    return {
      type,
      mappings,
      ...(title ? { title } : {}),
      ...(insights.length > 0 ? { insights } : {})
    };
  }

  private readVisKeyValues(input: string): Map<string, string> {
    const result = new Map<string, string>();
    const pattern =
      /([a-zA-Z_][a-zA-Z0-9_-]*)\s*(?:=|:)\s*("[^"]*"|'[^']*'|`[^`]*`|[^\n,;]+)/g;
    let match: RegExpExecArray | null = pattern.exec(input);
    while (match) {
      const key = match[1]?.toLowerCase();
      const value = this.stripQuotes(match[2] ?? "");
      if (key && value) {
        result.set(key, value);
      }
      match = pattern.exec(input);
    }
    return result;
  }

  private extractJsonObject(input: string): string | undefined {
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return undefined;
    }
    return input.slice(start, end + 1).trim();
  }

  private splitInsights(value: string | undefined): string[] {
    if (!value) {
      return [];
    }
    return value
      .split(/[|;\n]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private hasAnyMapping(mappings: ChartBiFieldMappings): boolean {
    return Boolean(
      mappings.x ||
        mappings.y ||
        mappings.dimension ||
        mappings.measure ||
        mappings.time ||
        mappings.category ||
        mappings.value
    );
  }

  private normalizeType(value: unknown): ChartBiDisplayType | undefined {
    const raw = this.readString(value)?.toLowerCase();
    if (!raw) {
      return undefined;
    }
    return (CHARTBI_DISPLAY_ALLOWLIST as readonly string[]).includes(raw)
      ? (raw as ChartBiDisplayType)
      : undefined;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.readString(item))
        .filter((item): item is string => Boolean(item));
    }

    if (typeof value === "string") {
      return this.splitInsights(value);
    }

    return [];
  }

  private stripQuotes(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      return trimmed;
    }
    const quote = trimmed[0];
    if ((quote === '"' || quote === "'" || quote === "`") && trimmed.endsWith(quote)) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
