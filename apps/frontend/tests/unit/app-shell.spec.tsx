import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/app-shell";
import { StateBlock } from "@/components/ui/state-block";

describe("AppShell", () => {
  it("renders title, description, and children", () => {
    render(
      <AppShell title="Shell Title" description="Shell description">
        <div>Child content</div>
      </AppShell>
    );

    expect(screen.getByRole("heading", { name: "Shell Title" })).toBeInTheDocument();
    expect(screen.getByText("Shell description")).toBeInTheDocument();
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders state block variants", () => {
    render(<StateBlock variant="loading">Loading</StateBlock>);
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });
});
