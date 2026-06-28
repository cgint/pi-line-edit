import { describe, expect, it } from "vitest";
import { readFile } from "fs/promises";
import Ajv from "ajv";
import {
  assertWriteRequest,
  registerWriteTool,
  writeToolSchema,
} from "../../src/write";
import { makeFakePiRegistry, withTempFile } from "../support/fixtures";

describe("assertWriteRequest", () => {
  it("accepts a valid write request", () => {
    expect(() =>
      assertWriteRequest({
        path: "a.ts",
        content: "export {};\n",
      }),
    ).not.toThrow();
  });
});

describe("registerWriteTool", () => {
  it("publishes a schema without intent/rationale fields", () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(writeToolSchema as any);
    const validWrite = {
      path: "a.ts",
      content: "export {};\n",
    };

    expect(validate(validWrite)).toBe(true);

    // intent/rationale must be rejected (additionalProperties: false)
    expect(validate({ ...validWrite, intent: "nope" })).toBe(false);
    expect(validate({ ...validWrite, rationale: "nope" })).toBe(false);
    expect(validate({ ...validWrite, confidence: 8 })).toBe(false);
    expect(validate({ ...validWrite, confidenceReason: "obsolete" })).toBe(false);
    expect(validate({ ...validWrite, extra: "nope" })).toBe(false);
  });

  it("renders write call without provenance metadata", () => {
    const { pi, getTool } = makeFakePiRegistry();
    registerWriteTool(pi);
    const writeTool = getTool("write");
    const theme = {
      bold: (text: string) => text,
      fg: (_token: string, text: string) => text,
    };

    const component = writeTool.renderCall(
      {
        path: "sample.txt",
        content: "hello\n",
      },
      theme,
      {
        argsComplete: false,
        state: {},
        cwd: process.cwd(),
        expanded: false,
        lastComponent: undefined,
        invalidate() {},
      },
    ) as { render: (width: number) => string[] };

    const rendered = component.render(200).join("\n");
    expect(rendered).toContain("write sample.txt");
    expect(rendered).not.toContain("provenance");
    expect(rendered).not.toContain("Intent");
    expect(rendered).not.toContain("Rationale");
  });

  it("delegates execution to the built-in write tool", async () => {
    await withTempFile("sample.txt", "old\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerWriteTool(pi);
      const writeTool = getTool("write");

      await writeTool.execute(
        "w1",
        {
          path: "sample.txt",
          content: "new\n",
        },
        undefined,
        undefined,
        { cwd } as any,
      );

      expect(await readFile(path, "utf-8")).toBe("new\n");
    });
  });
});
