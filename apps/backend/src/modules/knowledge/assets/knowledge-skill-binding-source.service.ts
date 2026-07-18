import { Injectable } from "@nestjs/common";
import type {
  SkillRegistryBinding,
  SkillRegistryBindingSource
} from "../../skill-registry/skill-registry.service";
import { KnowledgeAssetFacade } from "./knowledge-asset.facade";

@Injectable()
export class KnowledgeSkillBindingSource implements SkillRegistryBindingSource {
  constructor(private readonly assets: KnowledgeAssetFacade) {}

  async listActiveBindings(input: {
    workspaceId: string;
    capabilityGrant: string[];
  }): Promise<readonly SkillRegistryBinding[]> {
    if (!this.assets.isReady()) {
      return [];
    }
    const assets = await this.assets.listActive({
      workspaceId: input.workspaceId,
      assetKind: "skill",
      capabilityGrant: input.capabilityGrant
    });
    return assets.flatMap((asset) => this.toBinding(asset.content));
  }

  private toBinding(content: Record<string, unknown>): SkillRegistryBinding[] {
    if (content.version !== "knowledge-skill-binding.v1") {
      return [];
    }
    const skills = Array.isArray(content.skills)
      ? content.skills.flatMap((skill) => {
          if (!isRecord(skill)) {
            return [];
          }
          const key = typeof skill.key === "string" ? skill.key.trim() : "";
          const name = typeof skill.name === "string" ? skill.name.trim() : "";
          return key && name ? [{ key, name }] : [];
        })
      : [];
    const domain = typeof content.domain === "string" ? content.domain : "";
    const term = typeof content.term === "string" ? content.term : "";
    if (!domain.trim() || !term.trim() || skills.length === 0) {
      return [];
    }
    return [
      {
        domain,
        term,
        term_aliases: strings(content.termAliases),
        context_keywords: strings(content.contextKeywords),
        skills
      }
    ];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
