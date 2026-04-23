import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelingRelationshipEditor } from "@/components/settings/modeling/modeling-relationship-editor";

describe("ModelingRelationshipEditor", () => {
  it("adds and saves relationship edges", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<ModelingRelationshipEditor relationships={[]} onSave={onSave} />);

    await user.type(screen.getByRole("textbox", { name: "左端 dataset" }), "analytics");
    await user.type(screen.getByRole("textbox", { name: "左端 table" }), "orders");
    await user.type(screen.getByRole("textbox", { name: "左端 column" }), "customer_id");
    await user.type(screen.getByRole("textbox", { name: "右端 dataset" }), "analytics");
    await user.type(screen.getByRole("textbox", { name: "右端 table" }), "customers");
    await user.type(screen.getByRole("textbox", { name: "右端 column" }), "id");
    await user.clear(screen.getByRole("textbox", { name: "关系可信度" }));
    await user.type(screen.getByRole("textbox", { name: "关系可信度" }), "0.9");

    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await user.click(screen.getByRole("button", { name: "保存关系" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith([
        {
          id: "orders_customer_id__customers_id",
          name: undefined,
          source: "manual",
          confidence: 0.9,
          bridge: {
            left: {
              dataset: "analytics",
              table: "orders",
              column: "customer_id"
            },
            right: {
              dataset: "analytics",
              table: "customers",
              column: "id"
            },
            operator: "eq",
            confidence: 0.9
          }
        }
      ]);
    });
  });
});
