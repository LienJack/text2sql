import { Injectable } from "@nestjs/common";

export interface DatasourceDefinition {
  id: string;
  type: "sqlite" | "postgres";
  readonly: boolean;
  location: string;
  enabled: boolean;
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
}

