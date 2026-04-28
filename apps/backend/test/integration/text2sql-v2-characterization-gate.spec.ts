import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type CharacterizationSurface = {
  version: string;
  stageOrder: string[];
  stageArtifactCount: number;
  hasSemanticPlan: boolean;
};

type CharacterizationCase = {
  id: string;
  scenario: string;
  expectedStageOrder: string[];
  surfaces: Record<string, CharacterizationSurface>;
};

describe("text2sql v2 characterization gate integration", () => {
  it("ensures sync/stream/replay/run-view/save-view share the same v2 artifact facts", () => {
    const fixturePath = resolve(
      __dirname,
      "../fixtures/text2sql-v2-characterization-cases.json"
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as CharacterizationCase[];

    expect(fixture.length).toBeGreaterThan(0);

    for (const item of fixture) {
      expect(item.expectedStageOrder.length).toBeGreaterThan(0);

      const surfaceNames = ["sync", "stream", "replay", "runView", "saveView"];
      for (const surfaceName of surfaceNames) {
        const surface = item.surfaces[surfaceName];
        expect(surface).toBeDefined();
        expect(surface.version).toBe("v2");
        expect(surface.stageOrder).toEqual(item.expectedStageOrder);
        expect(surface.stageArtifactCount).toBeGreaterThanOrEqual(
          item.expectedStageOrder.length
        );
      }

      const semanticPlanParity = new Set(
        surfaceNames.map((surfaceName) => item.surfaces[surfaceName]?.hasSemanticPlan)
      );
      expect(semanticPlanParity.size).toBe(1);
    }
  });
});
