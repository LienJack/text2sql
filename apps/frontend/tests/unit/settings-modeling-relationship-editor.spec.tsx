import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ModelingGraphModel } from "@text2sql/shared-types";
import { ModelingRelationshipEditor } from "@/components/settings/modeling/modeling-relationship-editor";

if (typeof Element !== "undefined") {
  const elementPrototype = Element.prototype as Element & {
    hasPointerCapture?: (pointerId: number) => boolean;
    releasePointerCapture?: (pointerId: number) => void;
    setPointerCapture?: (pointerId: number) => void;
  };
  if (typeof elementPrototype.hasPointerCapture !== "function") {
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => false
    });
  }
  if (typeof elementPrototype.releasePointerCapture !== "function") {
    Object.defineProperty(Element.prototype, "releasePointerCapture", {
      configurable: true,
      value: () => undefined
    });
  }
  if (typeof elementPrototype.setPointerCapture !== "function") {
    Object.defineProperty(Element.prototype, "setPointerCapture", {
      configurable: true,
      value: () => undefined
    });
  }
}

describe("ModelingRelationshipEditor", () => {
  it("adds and saves relationship edges via selectable table/field dialog", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const models: ModelingGraphModel[] = [
      {
        id: "model.orders",
        tableName: "orders",
        modelName: "orders",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true },
          { name: "customer_id", dataType: "integer", isNullable: false, isPrimaryKey: false }
        ]
      },
      {
        id: "model.customers",
        tableName: "customers",
        modelName: "customers",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, isPrimaryKey: true },
          { name: "name", dataType: "text", isNullable: true, isPrimaryKey: false }
        ]
      }
    ];

    render(
      <ModelingRelationshipEditor
        models={models}
        relationships={[]}
        defaultFromTable="orders"
        onSave={onSave}
      />
    );

    const pickSelectOption = async (triggerLabel: string, optionName: string): Promise<void> => {
      await user.click(screen.getByLabelText(triggerLabel));
      await user.click(await screen.findByRole("option", { name: optionName }));
    };

    await user.click(screen.getByRole("button", { name: "添加关系" }));
    await pickSelectOption("From table", "orders");
    await pickSelectOption("From field", "customer_id");
    await pickSelectOption("To table", "customers");
    await pickSelectOption("To field", "id");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await user.click(screen.getByRole("button", { name: "保存关系" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith([
        {
          id: "orders_customer_id__customers_id",
          name: undefined,
          source: "manual",
          confidence: 0.8,
          bridge: {
            left: {
              dataset: "",
              table: "orders",
              column: "customer_id"
            },
            right: {
              dataset: "",
              table: "customers",
              column: "id"
            },
            operator: "eq",
            confidence: 0.8
          }
        }
      ]);
    });
  });
});
