import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelingMetadataEditor } from "@/components/settings/modeling/modeling-metadata-editor";

describe("ModelingMetadataEditor", () => {
  it("saves displayName and description updates", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <ModelingMetadataEditor
        target={{
          kind: "model",
          id: "model.orders",
          title: "Orders",
          technicalName: "orders",
          displayName: "Orders",
          description: "old description"
        }}
        onSave={onSave}
      />
    );

    await user.clear(screen.getByRole("textbox", { name: "显示名称" }));
    await user.type(screen.getByRole("textbox", { name: "显示名称" }), "订单模型");
    await user.clear(screen.getByRole("textbox", { name: "描述" }));
    await user.type(screen.getByRole("textbox", { name: "描述" }), "订单业务主模型");

    await user.click(screen.getByRole("button", { name: "保存 Metadata" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        displayName: "订单模型",
        description: "订单业务主模型"
      });
    });
  });
});
