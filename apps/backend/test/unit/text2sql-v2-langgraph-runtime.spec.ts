import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

describe("Text2SQL v2 LangGraph runtime baseline", () => {
  it("compiles and invokes a minimal StateGraph under the backend Jest toolchain", async () => {
    const RuntimeState = Annotation.Root({
      path: Annotation<string[]>({
        reducer: (left, right) =>
          left.concat(Array.isArray(right) ? right : [right]),
        default: () => []
      }),
      compiled: Annotation<boolean>({
        reducer: (_left, right) => right,
        default: () => false
      })
    });

    const graph = new StateGraph(RuntimeState)
      .addNode("bootstrap", () => ({
        path: ["bootstrap"],
        compiled: true
      }))
      .addEdge(START, "bootstrap")
      .addEdge("bootstrap", END)
      .compile();

    const result = await graph.invoke({});

    expect(result).toEqual({
      path: ["bootstrap"],
      compiled: true
    });
  });
});
