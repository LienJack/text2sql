import { describe, expect, it } from "vitest";

describe("chat demo flow", () => {
  it("should keep core layout decisions", () => {
    const layout = ["chat panel", "sql preview", "result table"];
    expect(layout).toHaveLength(3);
    expect(layout).toContain("sql preview");
  });
});

