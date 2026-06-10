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
        intent: "Create the requested module.",
        rationale: "The file needs complete initial content.",
        confidence: 8,
        confidenceReason: "The payload includes all required write fields.",
      }),
    ).not.toThrow();
  });
});

describe("registerWriteTool", () => {
  it("publishes a schema requiring non-empty provenance metadata and bounded integer confidence", () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(writeToolSchema as any);
    const validWrite = {
      path: "a.ts",
      content: "export {};\n",
      intent: "Create the requested module.",
      rationale: "The file needs complete initial content.",
      confidence: 8,
      confidenceReason: "The payload includes all required write fields.",
    };

    expect(validate(validWrite)).toBe(true);

    for (const key of ["intent", "rationale", "confidence", "confidenceReason"] as const) {
      const write = { ...validWrite };
      delete write[key];
      expect(validate(write)).toBe(false);
    }

    for (const key of ["intent", "rationale", "confidenceReason"] as const) {
      expect(validate({ ...validWrite, [key]: "" })).toBe(false);
    }

    expect(validate({ ...validWrite, confidence: -1 })).toBe(false);
    expect(validate({ ...validWrite, confidence: 11 })).toBe(false);
    expect(validate({ ...validWrite, confidence: 7.5 })).toBe(false);
    expect(validate({ ...validWrite, extra: "nope" })).toBe(false);
  });

  it("renders write provenance metadata in the visible call", () => {
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
        intent: "Create the greeting file.",
        rationale: "The requested output needs this file.",
        confidence: 8,
        confidenceReason: "The content is small and directly requested.",
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
    expect(rendered).toContain("Write provenance:");
    expect(rendered).toContain("Write confidence: 8/10");
    expect(rendered).toContain("Intent: Create the greeting file.");
    expect(rendered).toContain("Rationale: The requested output needs this file.");
    expect(rendered).toContain("Confidence reason: The content is small and directly requested.");
    expect(rendered).toContain("--------------");
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
          intent: "Replace the file with the requested content.",
          rationale: "The write tool is appropriate for full-file replacement.",
          confidence: 8,
          confidenceReason: "This test verifies the resulting file content directly.",
        },
        undefined,
        undefined,
        { cwd } as any,
      );

      expect(await readFile(path, "utf-8")).toBe("new\n");
    });
  });
});
