import { describe, expect, it } from "vitest";
import { settleWithConcurrency } from "@/modules/workflow";

describe("native workflow runtime", () => {
  it("limits concurrent tasks and settles every result after a rejection", async () => {
    let active = 0;
    let maxActive = 0;
    const completed: number[] = [];

    const tasks = [0, 1, 2, 3].map((index) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      completed.push(index);
      if (index === 1) throw new Error("source failed");
      return index;
    });

    const results = await settleWithConcurrency(tasks, 2);

    expect(maxActive).toBe(2);
    expect(completed).toHaveLength(4);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
  });
});
