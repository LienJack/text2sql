import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelingCalculatedFieldEditor } from "@/components/settings/modeling/modeling-calculated-field-editor";

describe("ModelingCalculatedFieldEditor", () => {
  it("adds and saves calculated fields for selected model", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <ModelingCalculatedFieldEditor
        model={{
          id: "model.orders",
          tableName: "orders",
          modelName: "orders",
          displayName: "Orders",
          description: null,
          columns: []
        }}
        calculatedFields={[]}
        onSave={onSave}
      />
    );

    await user.type(screen.getByRole("textbox", { name: "计算字段名称" }), "total_amount");
    await user.type(screen.getByRole("textbox", { name: "表达式" }), "sum(price)");
    await user.type(screen.getByRole("textbox", { name: "数据类型" }), "decimal");

    await user.click(screen.getByRole("button", { name: "添加计算字段" }));
    await user.click(screen.getByRole("button", { name: "保存计算字段" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith([
        {
          id: "model.orders.total_amount",
          modelId: "model.orders",
          name: "total_amount",
          expression: "sum(price)",
          dataType: "decimal"
        }
      ]);
    });
  });
});
