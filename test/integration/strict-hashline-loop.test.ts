import { describe, expect, it } from "vitest";
import { readFile } from "fs/promises";
import register from "../../index";
import { makeFakePiRegistry, withTempFile } from "../support/fixtures";

describe("line-number edit tool loop", () => {
  it("supports read -> edit -> reuse the same line number against current content", async () => {
    await withTempFile("sample.ts", "alpha\nbeta\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      register(pi);
      const ctx = { cwd, ui: { notify() {} } } as any;

      const readTool = getTool("read");
      const editTool = getTool("edit");

      const firstRead = await readTool.execute("r1", { path: "sample.ts" }, undefined, undefined, ctx);
      const firstText = firstRead.content[0].text as string;
      const betaRef = firstText
        .split("\n")
        .find((line: string) => line.includes("│beta"))!
        .split("│")[0]!
        .trim();

      expect(betaRef).toBe("2");

      await editTool.execute(
        "e1",
        {
          path: "sample.ts",
          edits: [{ range: [betaRef, betaRef], lines: ["BETA1"] }],
        },
        undefined,
        undefined,
        ctx,
      );

      const secondEdit = await editTool.execute(
        "e2",
        {
          path: "sample.ts",
          edits: [{ range: [betaRef, betaRef], lines: ["BETA2"] }],
        },
        undefined,
        undefined,
        ctx,
      );

      expect(secondEdit.content[0].text).toContain("-2│BETA1");
      expect(secondEdit.content[0].text).toContain("+2│BETA2");
      expect(await readFile(path, "utf-8")).toBe("alpha\nBETA2\n");
    });
  });
});
