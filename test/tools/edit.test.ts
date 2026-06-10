import { describe, expect, it } from "vitest";
import { readFile } from "fs/promises";
import Ajv from "ajv";
import {
  assertEditRequest,
  hashlineEditToolSchema,
  registerEditTool,
} from "../../src/edit";
import { computeLineHash } from "../../src/hashline";
import { computePublicLineChecksum } from "../../src/line-ref";
import { makeFakePiRegistry, withTempFile } from "../support/fixtures";

describe("assertEditRequest", () => {
  it("accepts valid replace edit", () => {
    expect(() =>
      assertEditRequest({
        path: "a.ts",
        edits: [{ range: ["1#AB", "1#AB"], lines: ["x"] }],
      }),
    ).not.toThrow();
  });

});

describe("registerEditTool", () => {
  it("publishes a schema that validates strict hashline payloads", () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(hashlineEditToolSchema as any);

    expect(
      validate({
        path: "a.ts",
        edits: [
          {
            range: ["1#AB", "1#AB"],
            lines: ["x"],
            intent: "Replace the target line with x.",
            rationale: "The test exercises the published hashline edit payload.",
            confidence: 8,
            confidenceReason: "The payload is a direct schema fixture with valid required fields.",
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects append/prepend in published schema (hidden at runtime)", () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(hashlineEditToolSchema as any);

    expect(
      validate({
        path: "a.ts",
        edits: [
          {
            after: "1#AB",
            lines: ["x"],
            intent: "Append x after the target line.",
            rationale: "This intentionally checks the unsupported append shape.",
            confidence: 8,
            confidenceReason: "The payload is expected to fail because after is not published.",
          },
        ],
      }),
    ).toBe(false);

    expect(
      validate({
        path: "a.ts",
        edits: [
          {
            before: "1#AB",
            lines: ["x"],
            intent: "Prepend x before the target line.",
            rationale: "This intentionally checks the unsupported prepend shape.",
            confidence: 8,
            confidenceReason: "The payload is expected to fail because before is not published.",
          },
        ],
      }),
    ).toBe(false);
  });

  it("requires non-empty provenance metadata and bounded integer confidence", () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(hashlineEditToolSchema as any);
    const validEdit = {
      range: ["1#AB", "1#AB"],
      lines: ["x"],
      intent: "Replace the target line with x.",
      rationale: "The caller requested this exact replacement.",
      confidence: 8,
      confidenceReason: "The edit is a direct replacement fixture with all required fields present.",
    };

    for (const key of ["intent", "rationale", "confidence", "confidenceReason"] as const) {
      const edit = { ...validEdit };
      delete edit[key];
      expect(validate({ path: "a.ts", edits: [edit] })).toBe(false);
    }

    for (const key of ["intent", "rationale", "confidenceReason"] as const) {
      expect(validate({ path: "a.ts", edits: [{ ...validEdit, [key]: "" }] })).toBe(false);
    }

    expect(validate({ path: "a.ts", edits: [{ ...validEdit, confidence: -1 }] })).toBe(false);
    expect(validate({ path: "a.ts", edits: [{ ...validEdit, confidence: 11 }] })).toBe(false);
    expect(validate({ path: "a.ts", edits: [{ ...validEdit, confidence: 7.5 }] })).toBe(false);
  });

  it("publishes an OpenAI-compatible object schema for pi tool registration", () => {
    expect((hashlineEditToolSchema as any).type).toBe("object");
    expect((hashlineEditToolSchema as any).anyOf).toBeUndefined();

    const rangeSchema = (hashlineEditToolSchema as any).properties.edits.items.properties.range;
    expect(Array.isArray(rangeSchema.items)).toBe(false);
    expect(rangeSchema.items.type).toBe("string");
    expect(rangeSchema.items.minLength).toBe(1);
    expect(rangeSchema.minItems).toBe(2);
    expect(rangeSchema.maxItems).toBe(2);

    const editProperties = (hashlineEditToolSchema as any).properties.edits.items.properties;
    expect(editProperties.intent.minLength).toBe(1);
    expect(editProperties.rationale.minLength).toBe(1);
    expect(editProperties.confidence.type).toBe("integer");
    expect(editProperties.confidence.minimum).toBe(0);
    expect(editProperties.confidence.maximum).toBe(10);
    expect(editProperties.confidenceReason.minLength).toBe(1);
  });

  it("registers the edit tool without a prepareArguments shim", () => {
    let registered:
      | {
          parameters?: any;
          prepareArguments?: (args: unknown) => unknown;
        }
      | undefined;
    const pi = {
      registerTool(tool: {
        parameters?: any;
        prepareArguments?: (args: unknown) => unknown;
      }) {
        registered = tool;
      },
    } as any;

    registerEditTool(pi);

    expect(registered?.parameters).toEqual(hashlineEditToolSchema);
    expect(registered?.prepareArguments).toBeUndefined();
  });

  it("renders edit provenance metadata in the visible call", () => {
    const { pi, getTool } = makeFakePiRegistry();
    registerEditTool(pi);
    const editTool = getTool("edit");
    const theme = {
      bold: (text: string) => text,
      fg: (_token: string, text: string) => text,
    };

    const component = editTool.renderCall(
      {
        path: "sample.txt",
        edits: [
          {
            range: ["1#AB", "1#AB"],
            lines: ["hello"],
            intent: "Replace the greeting line.",
            rationale: "The requested output uses the new greeting.",
            confidence: 8,
            confidenceReason: "The replacement is localized and directly requested.",
          },
        ],
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
    expect(rendered).toContain("Edit provenance:");
    expect(rendered).toContain("Edit 1 - Confidence: 8/10");
    expect(rendered).toContain("Intent: Replace the greeting line.");
    expect(rendered).toContain("Rationale: The requested output uses the new greeting.");
    expect(rendered).toContain("Confidence reason: The replacement is localized and directly requested.");
    expect(rendered).toContain("--------------");
  });

  it("executes strict hashline replace through the normal path", async () => {
    await withTempFile("sample.txt", "aaa\nbbb\nccc\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");

      const result = await editTool.execute(
        "e1",
        {
          path: "sample.txt",
          edits: [
            {
              range: [`2#${computeLineHash(["aaa", "bbb", "ccc"], 1)}`, `2#${computeLineHash(["aaa", "bbb", "ccc"], 1)}`],
              lines: ["BBB"],
            },
          ],
        },
        undefined,
        undefined,
        { cwd } as any,
      );

      expect(await readFile(path, "utf-8")).toBe("aaa\nBBB\nccc\n");
      expect(result.details?.diff).toContain("+2");
      expect(result.details?.diff).toContain("│BBB");
    });
  });

  it("renders details diff while keeping diff out of LLM-visible text", async () => {
    await withTempFile("sample.txt", "aaa\nbbb\nccc\n", async ({ cwd }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");
      const editArgs = {
        path: "sample.txt",
        edits: [
          {
            range: [`2#${computeLineHash(["aaa", "bbb", "ccc"], 1)}│bbb`, `2#${computeLineHash(["aaa", "bbb", "ccc"], 1)}│bbb`],
            lines: ["BBB"],
          },
        ],
      };

      const result = await editTool.execute(
        "e1",
        editArgs,
        undefined,
        undefined,
        { cwd } as any,
      );

      expect(typeof editTool.renderResult).toBe("function");

      const component = editTool.renderResult(
        result,
        { expanded: false, isPartial: false },
        {
          bold: (text: string) => text,
          fg: (token: string, text: string) => `[${token}]${text}[/${token}]`,
        },
        {
          args: editArgs,
          isError: false,
          lastComponent: undefined,
        } as any,
      ) as { render: (width: number) => string[] };

      const rendered = component.render(200).join("\n");

      expect(rendered).not.toContain("Changes: +1 -1");
      expect(rendered).not.toContain("Diff preview:");
      expect(rendered).not.toContain("```diff");
      expect(rendered).toMatch(/\[success\]\+2[a-z]│BBB\[\/success\]/);
      expect(rendered).not.toContain("Updated sample.txt");
      expect(rendered).not.toContain("```text");
      expect(result.details?.diff).toContain("+2");
    });
  });
  it("appends at EOF when plain range is the line after the final visible line", async () => {
    await withTempFile("sample.txt", "aaa\nbbb\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");

      const result = await editTool.execute(
        "e1",
        {
          path: "sample.txt",
          edits: [{ range: ["3", "3"], lines: ["ccc", "ddd"] }],
        },
        undefined,
        undefined,
        { cwd } as any,
      );

      expect(await readFile(path, "utf-8")).toBe("aaa\nbbb\nccc\nddd\n");
      expect(result.details?.diff).toMatch(/\+3[a-z]│ccc/);
      expect(result.details?.diff).toMatch(/\+4[a-z]│ddd/);
    });
  });

  it("reports a line-number out-of-bounds error without mentioning missing hashes", async () => {
    await withTempFile("sample.txt", "aaa\nbbb\n", async ({ cwd }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");

      await expect(
        editTool.execute(
          "e1",
          {
            path: "sample.txt",
            edits: [{ range: ["4", "4"], lines: ["too far"] }],
          },
          undefined,
          undefined,
          { cwd } as any,
        ),
      ).rejects.toThrow(/\[E_RANGE_OOB\].*line 4 does not exist.*file has 2 lines/i);

      await expect(
        editTool.execute(
          "e2",
          {
            path: "sample.txt",
            edits: [{ range: ["4", "4"], lines: ["too far"] }],
          },
          undefined,
          undefined,
          { cwd } as any,
        ),
      ).rejects.not.toThrow(/missing hash|LINE#HASH/i);
    });
  });
  it("accepts full endpoint lines and pipe separators with trimmed content matching", async () => {
    await withTempFile("sample.txt", "aaa\n   bbb\nccc\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");
      const lines = ["aaa", "   bbb", "ccc"];
      const ref = `2${computePublicLineChecksum(lines, 2)}|bbb`;

      await editTool.execute(
        "e1",
        {
          path: "sample.txt",
          edits: [{ range: [ref, ref], lines: ["   BBB"] }],
        },
        undefined,
        undefined,
        { cwd } as any,
      );

      expect(await readFile(path, "utf-8")).toBe("aaa\n   BBB\nccc\n");
    });
  });

  it("rejects default full endpoint lines when endpoint content points at the wrong line", async () => {
    await withTempFile("sample.txt", "aaa\nbbb\nccc\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");
      const lines = ["aaa", "bbb", "ccc"];
      const ref = `2${computePublicLineChecksum(lines, 2)}│ccc`;

      await expect(
        editTool.execute(
          "e1",
          {
            path: "sample.txt",
            edits: [{ range: [ref, ref], lines: ["BBB"] }],
          },
          undefined,
          undefined,
          { cwd } as any,
        ),
      ).rejects.toThrow(/E_LINE_CONTENT_MISMATCH/);
      expect(await readFile(path, "utf-8")).toBe("aaa\nbbb\nccc\n");
    });
  });

  it("limits the default edit tool to three edit entries per call", async () => {
    await withTempFile("sample.txt", "a\nb\nc\nd\n", async ({ cwd }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");

      await expect(
        editTool.execute(
          "e1",
          {
            path: "sample.txt",
            edits: [
              { range: ["1", "1"], lines: ["A"] },
              { range: ["2", "2"], lines: ["B"] },
              { range: ["3", "3"], lines: ["C"] },
              { range: ["4", "4"], lines: ["D"] },
            ],
          },
          undefined,
          undefined,
          { cwd } as any,
        ),
      ).rejects.toThrow(/E_TOO_MANY_EDITS/);
    });
  });

  it("keeps legacy edit behavior without endpoint content validation or the default edit-count limit", async () => {
    const previous = process.env.PI_LINE_EDIT_REGISTER_LEGACY;
    process.env.PI_LINE_EDIT_REGISTER_LEGACY = "1";
    try {
      await withTempFile("sample.txt", "aaa\nbbb\nccc\nddd\n", async ({ cwd, path }) => {
        const { pi, getTool } = makeFakePiRegistry();
        registerEditTool(pi);
        const legacyEditTool = getTool("edit_legacy");
        const lines = ["aaa", "bbb", "ccc", "ddd"];
        const bRefWithWrongContent = `2${computePublicLineChecksum(lines, 2)}│ccc`;

        await legacyEditTool.execute(
          "e1",
          {
            path: "sample.txt",
            edits: [
              { range: ["1", "1"], lines: ["AAA"] },
              { range: [bRefWithWrongContent, bRefWithWrongContent], lines: ["BBB"] },
              { range: ["3", "3"], lines: ["CCC"] },
              { range: ["4", "4"], lines: ["DDD"] },
            ],
          },
          undefined,
          undefined,
          { cwd } as any,
        );

        expect(await readFile(path, "utf-8")).toBe("AAA\nBBB\nCCC\nDDD\n");
      });
    } finally {
      if (previous === undefined) {
        delete process.env.PI_LINE_EDIT_REGISTER_LEGACY;
      } else {
        process.env.PI_LINE_EDIT_REGISTER_LEGACY = previous;
      }
    }
  });
});
  it("rejects edits on empty files with E_EMPTY_FILE", async () => {
    await withTempFile("empty.txt", "", async ({ cwd }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");

      await expect(
        editTool.execute(
          "e1",
          {
            path: "empty.txt",
            edits: [{ range: ["1#AB", "1#AB"], lines: ["hello"] }],
          },
          undefined,
          undefined,
          { cwd } as any,
        ),
      ).rejects.toThrow(/\[E_EMPTY_FILE\]/);
    });
  });
