import { describe, expect, it } from "vitest";
import { readFile } from "fs/promises";
import register from "../../index";
import { makeFakePiRegistry, withTempFile } from "../support/fixtures";

describe("line-number edit tool loop", () => {
  it("rejects stale checked refs while allowing bare line-number fallback", async () => {
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

      expect(betaRef).toMatch(/^2[a-z]$/);

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

      await expect(
        editTool.execute(
          "e2-stale",
          {
            path: "sample.ts",
            edits: [{ range: [betaRef, betaRef], lines: ["BETA2"] }],
          },
          undefined,
          undefined,
          ctx,
        ),
      ).rejects.toThrow(/\[E_STALE_LINE\]/);

      const secondEdit = await editTool.execute(
        "e2-bare",
        {
          path: "sample.ts",
          edits: [{ range: ["2", "2"], lines: ["BETA2"] }],
        },
        undefined,
        undefined,
        ctx,
      );

      expect(secondEdit.content[0].text).toMatch(/-2[a-z]│BETA1/);
      expect(secondEdit.content[0].text).toMatch(/\+2[a-z]│BETA2/);
      expect(await readFile(path, "utf-8")).toBe("alpha\nBETA2\n");
    });
  });
});
