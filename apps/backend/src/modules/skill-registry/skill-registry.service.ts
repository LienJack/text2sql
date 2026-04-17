import { Injectable } from "@nestjs/common";

export const SKILL_REGISTRY_UNAVAILABLE_REASON = "skill_registry_unavailable";

export interface SkillRegistryLookupInput {
  domain: string;
  term: string;
  context?: Record<string, unknown>;
}

export interface SkillRegistrySkill {
  key: string;
  name: string;
}

export interface SkillRegistryContextEntry {
  source: "skill_registry";
  domain: string;
  term: string;
  matched_by: "term" | "context";
}

export interface SkillRegistryLookupResult {
  skills: SkillRegistrySkill[];
  context: SkillRegistryContextEntry[];
  degrade_reason?: string;
}

interface SkillRegistryBinding {
  domain: string;
  term: string;
  term_aliases: string[];
  context_keywords: string[];
  skills: SkillRegistrySkill[];
}

interface SkillRegistryBindingMatch {
  binding: SkillRegistryBinding;
  matchedBy: "term" | "context";
}

interface SkillRegistryLookupContext {
  domain: string;
  term: string;
  contextTokens: Set<string>;
}

const SKILL_REGISTRY_SOURCE: SkillRegistryContextEntry["source"] = "skill_registry";

const DEFAULT_BINDINGS: readonly SkillRegistryBinding[] = [
  {
    domain: "semantic_term",
    term: "gmv",
    term_aliases: ["gross merchandise volume", "交易额"],
    context_keywords: ["gmv", "gross merchandise", "交易额"],
    skills: [
      { key: "metric_term_resolution", name: "指标术语解析" },
      { key: "aggregation_sql_builder", name: "聚合 SQL 构建" }
    ]
  },
  {
    domain: "schema",
    term: "join_path",
    term_aliases: ["join", "关系路径", "外键路径"],
    context_keywords: ["join", "foreign key", "关联", "外键"],
    skills: [
      { key: "schema_join_planning", name: "Schema Join 规划" },
      { key: "risk_join_validation", name: "Join 风险校验" }
    ]
  },
  {
    domain: "sql_example",
    term: "time_series",
    term_aliases: ["趋势", "同比", "环比"],
    context_keywords: ["trend", "同比", "环比", "date_trunc"],
    skills: [
      { key: "sql_example_recall", name: "SQL 示例召回" },
      { key: "time_bucket_inference", name: "时间粒度推断" }
    ]
  }
];

@Injectable()
export class SkillRegistryService {
  async resolveSkills(input: SkillRegistryLookupInput): Promise<SkillRegistryLookupResult> {
    const domain = this.normalize(input.domain);
    const term = this.normalize(input.term);
    if (!domain || !term) {
      return this.emptyResult();
    }
    const lookupContext: SkillRegistryLookupContext = {
      domain,
      term,
      contextTokens: this.collectContextTokens(input.context)
    };

    try {
      const matches = await this.lookupBindings(lookupContext);
      if (matches.length === 0) {
        return this.emptyResult();
      }
      return {
        skills: this.uniqueSkills(matches.flatMap((match) => match.binding.skills)),
        context: this.uniqueContext(matches)
      };
    } catch (error) {
      return {
        ...this.emptyResult(),
        degrade_reason: SKILL_REGISTRY_UNAVAILABLE_REASON
      };
    }
  }

  protected async lookupBindings(
    input: SkillRegistryLookupContext
  ): Promise<SkillRegistryBindingMatch[]> {
    const matches: SkillRegistryBindingMatch[] = [];
    for (const binding of DEFAULT_BINDINGS) {
      if (this.normalize(binding.domain) !== input.domain) {
        continue;
      }
      if (this.matchesTerm(binding, input.term)) {
        matches.push({ binding, matchedBy: "term" });
        continue;
      }
      if (this.matchesContext(binding, input.contextTokens)) {
        matches.push({ binding, matchedBy: "context" });
      }
    }
    return matches;
  }

  private matchesTerm(binding: SkillRegistryBinding, term: string): boolean {
    if (this.normalize(binding.term) === term) {
      return true;
    }
    return binding.term_aliases.some((alias) => this.normalize(alias) === term);
  }

  private matchesContext(binding: SkillRegistryBinding, contextTokens: Set<string>): boolean {
    if (contextTokens.size === 0) {
      return false;
    }
    for (const rawKeyword of binding.context_keywords) {
      const keyword = this.normalize(rawKeyword);
      if (!keyword) {
        continue;
      }
      if (contextTokens.has(keyword)) {
        return true;
      }
      for (const token of contextTokens) {
        if (token.includes(keyword) || keyword.includes(token)) {
          return true;
        }
      }
    }
    return false;
  }

  private uniqueSkills(skills: SkillRegistrySkill[]): SkillRegistrySkill[] {
    const unique = new Map<string, SkillRegistrySkill>();
    for (const skill of skills) {
      if (!unique.has(skill.key)) {
        unique.set(skill.key, skill);
      }
    }
    return [...unique.values()];
  }

  private uniqueContext(matches: SkillRegistryBindingMatch[]): SkillRegistryContextEntry[] {
    const unique = new Map<string, SkillRegistryContextEntry>();
    for (const match of matches) {
      const key = `${match.binding.domain}|${match.binding.term}|${match.matchedBy}`;
      if (unique.has(key)) {
        continue;
      }
      unique.set(key, {
        source: SKILL_REGISTRY_SOURCE,
        domain: match.binding.domain,
        term: match.binding.term,
        matched_by: match.matchedBy
      });
    }
    return [...unique.values()];
  }

  private collectContextTokens(context?: Record<string, unknown>): Set<string> {
    const tokens = new Set<string>();
    if (!context) {
      return tokens;
    }

    const queue: unknown[] = [context];
    while (queue.length > 0) {
      const value = queue.shift();
      if (typeof value === "string") {
        const normalized = this.normalize(value);
        if (normalized) {
          tokens.add(normalized);
        }
        for (const segment of value.split(/[\s,;|]+/g)) {
          const normalizedSegment = this.normalize(segment);
          if (normalizedSegment) {
            tokens.add(normalizedSegment);
          }
        }
        continue;
      }
      if (Array.isArray(value)) {
        queue.push(...value);
        continue;
      }
      if (this.isRecord(value)) {
        queue.push(...Object.values(value));
      }
    }
    return tokens;
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private emptyResult(): SkillRegistryLookupResult {
    return {
      skills: [],
      context: []
    };
  }
}
