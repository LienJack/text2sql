import { Injectable } from "@nestjs/common";

export interface DatasourceDefinition {
  id: string;
  type: "sqlite" | "postgres";
  readonly: boolean;
  location: string;
  enabled: boolean;
  safetyPolicy?: "strict" | "standard";
  fallbackOnReject?: boolean;
}

@Injectable()
export class DatasourceRegistryService {
  private readonly sources = new Map<string, DatasourceDefinition>();

  register(def: DatasourceDefinition): void {
    this.sources.set(def.id, def);
  }

  list(): DatasourceDefinition[] {
    return Array.from(this.sources.values());
  }

  getById(id: string): DatasourceDefinition | undefined {
    return this.sources.get(id);
  }

  resolveSafetyPolicy(id: string): "strict" | "standard" {
    const source = this.sources.get(id);
    if (!source) {
      return "strict";
    }
    if (source.readonly) {
      return source.safetyPolicy ?? "strict";
    }
    return "strict";
  }

  shouldFallbackOnReject(id: string): boolean {
    const source = this.sources.get(id);
    if (!source) {
      return true;
    }
    return source.fallbackOnReject ?? true;
  }
}
