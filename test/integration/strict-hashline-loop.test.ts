import { describe, expect, it } from "vitest";
import { readFile } from "fs/promises";
import register from "../../index";
import { makeFakePiRegistry, withTempFile } from "../support/fixtures";

describe("line-number edit tool loop", () => {
  it("requires full endpoint refs and rejects stale full refs when endpoint content changed", async () => {
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
        .find((line: string) => line.includes("│beta"))!;

      expect(betaRef).toMatch(/^\s*2[a-z]│beta$/);

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
      ).rejects.toThrow(/\[E_LINE_CONTENT_MISMATCH\]/);

      const secondRead = await readTool.execute("r2", { path: "sample.ts" }, undefined, undefined, ctx);
      const beta1Ref = (secondRead.content[0].text as string)
        .split("\n")
        .find((line: string) => line.includes("│BETA1"))!;
      const secondEdit = await editTool.execute(
        "e2-refreshed",
        {
          path: "sample.ts",
          edits: [{ range: [beta1Ref, beta1Ref], lines: ["BETA2"] }],
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
