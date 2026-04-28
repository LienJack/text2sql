import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RagProviderCardGrid } from "@/components/settings/rag-provider-card-grid";

describe("RagProviderCardGrid", () => {
  it("emits provider presets for embedding cards", async () => {
    const user = userEvent.setup();
    const onSelectProvider = vi.fn();
    render(
      <RagProviderCardGrid
        taskType="embedding"
        onSelectProvider={onSelectProvider}
      />
    );

    await user.click(screen.getByLabelText("embedding-preset-volcengine"));
    await user.click(screen.getByLabelText("embedding-preset-tongyi"));
    await user.click(screen.getByLabelText("embedding-preset-siliconflow"));

    expect(onSelectProvider).toHaveBeenCalledTimes(3);
    expect(onSelectProvider.mock.calls[0]?.[0].provider).toBe("volcengine");
    expect(onSelectProvider.mock.calls[1]?.[0].provider).toBe("tongyi");
    expect(onSelectProvider.mock.calls[2]?.[0].provider).toBe("siliconflow");
  });

  it("protects dirty drafts with confirmation before overwrite", async () => {
    const user = userEvent.setup();
    const onSelectProvider = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <RagProviderCardGrid
        taskType="rerank"
        dirty
        onSelectProvider={onSelectProvider}
      />
    );

    await user.click(screen.getByLabelText("rerank-preset-volcengine"));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onSelectProvider).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("does not allow readonly users to apply cards", async () => {
    const user = userEvent.setup();
    const onSelectProvider = vi.fn();
    render(
      <RagProviderCardGrid
        taskType="embedding"
        readonly
        onSelectProvider={onSelectProvider}
      />
    );

    await user.click(screen.getByLabelText("embedding-preset-volcengine"));

    expect(onSelectProvider).not.toHaveBeenCalled();
  });
});
