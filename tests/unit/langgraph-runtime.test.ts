import { describe, expect, it } from "vitest";
import { z } from "zod";
import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";

describe("LangGraph runtime", () => {
  it("compiles and invokes Zod state", async () => {
    const State = new StateSchema({ value: z.number() });
    const graph = new StateGraph(State)
      .addNode("increment", ({ value }) => ({ value: value + 1 }))
      .addEdge(START, "increment")
      .addEdge("increment", END)
      .compile();

    await expect(graph.invoke({ value: 1 })).resolves.toMatchObject({ value: 2 });
  });
});
