import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformShell } from "@/components/layout/platform-shell";

const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname()
}));

describe("PlatformShell", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/chat");
  });

  it("renders navigation and children", () => {
    render(
      <PlatformShell>
        <div>Child content</div>
      </PlatformShell>
    );

    expect(screen.getByText("text2sql")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Chat/i })).toBeInTheDocument();
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("uses current pathname as title", () => {
    render(
      <PlatformShell>
        <div>Page body</div>
      </PlatformShell>
    );

    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
  });
});
