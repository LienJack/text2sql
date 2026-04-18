import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("settings retired governance ui guard", () => {
  it("keeps retired governance management UI files removed", () => {
    const frontendRoot = resolve(__dirname, "../../src/components/settings");
    const retiredFiles = [
      "rule-groups-management-panel.tsx",
      "rule-group-binding-dialog.tsx",
      "rule-group-rules-dialog.tsx",
      "rule-group-editor-dialog.tsx"
    ];

    for (const fileName of retiredFiles) {
      expect(existsSync(resolve(frontendRoot, fileName))).toBe(false);
    }
  });
});
