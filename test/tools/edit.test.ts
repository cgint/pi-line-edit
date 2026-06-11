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
  it("accepts valid replace edit envelope", () => {
    expect(() =>
      assertEditRequest({
        path: "a.ts",
        edits: [{ range: ["1a│old", "1a│old"], lines: ["x"] }],
      }),
    ).not.toThrow();
  });

});

describe("registerEditTool", () => {
  it("publishes a schema that validates long-form endpoint refs", () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(hashlineEditToolSchema as any);

    expect(
      validate({
        path: "a.ts",
        edits: [
          {
            range: ["1a│old", "1a│old"],
            lines: ["x"],
            intent: "Make the target line contain the expected fixture value.",
            rationale: "This exercises the published hashline edit payload with required full endpoint refs.",
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
            intent: "Attempt an append-style edit shape.",
            rationale: "This intentionally checks that unsupported append payloads remain rejected.",
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
            intent: "Attempt a prepend-style edit shape.",
            rationale: "This intentionally checks that unsupported prepend payloads remain rejected.",
          },
        ],
      }),
    ).toBe(false);
  });

  it("requires non-empty intent and rationale provenance metadata", () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(hashlineEditToolSchema as any);
    const validEdit = {
      range: ["1a│old", "1a│old"],
      lines: ["x"],
      intent: "Make the target line contain the expected fixture value.",
      rationale: "The caller requested this value and the fixture isolates the target line.",
    };

    expect(validate({ path: "a.ts", edits: [validEdit] })).toBe(true);

    for (const key of ["intent", "rationale"] as const) {
      const edit = { ...validEdit };
      delete edit[key];
      expect(validate({ path: "a.ts", edits: [edit] })).toBe(false);
      expect(validate({ path: "a.ts", edits: [{ ...validEdit, [key]: "" }] })).toBe(false);
    }

    expect(validate({ path: "a.ts", edits: [{ ...validEdit, confidence: 8 }] })).toBe(false);
    expect(validate({ path: "a.ts", edits: [{ ...validEdit, confidenceReason: "obsolete" }] })).toBe(false);
  });

  it("publishes an OpenAI-compatible object schema for pi tool registration", () => {
    expect((hashlineEditToolSchema as any).type).toBe("object");
    expect((hashlineEditToolSchema as any).anyOf).toBeUndefined();

    const editsSchema = (hashlineEditToolSchema as any).properties.edits;
    expect(editsSchema.minItems).toBe(1);
    expect(editsSchema.maxItems).toBe(3);

    const rangeSchema = editsSchema.items.properties.range;
    expect(Array.isArray(rangeSchema.items)).toBe(false);
    expect(rangeSchema.items.type).toBe("string");
    expect(rangeSchema.items.minLength).toBe(1);
    expect(rangeSchema.items.pattern).toContain("[│|]");
    expect(rangeSchema.minItems).toBe(2);
    expect(rangeSchema.maxItems).toBe(2);

    const editProperties = (hashlineEditToolSchema as any).properties.edits.items.properties;
    expect(editProperties.intent.minLength).toBe(1);
    expect(editProperties.rationale.minLength).toBe(1);
    expect(editProperties.confidence).toBeUndefined();
    expect(editProperties.confidenceReason).toBeUndefined();
  });

  it("rejects compact, plain, and hash-only range refs in the published schema", () => {
    const ajv = new Ajv({ allErrors: true });
    const validate = ajv.compile(hashlineEditToolSchema as any);
    const baseEdit = {
      lines: ["x"],
      intent: "Make the target line contain the expected fixture value.",
      rationale: "The default edit tool requires full endpoint refs so stale context can be checked safely.",
    };

    for (const range of [["1a", "1a"], ["1", "1"], ["1#AB", "1#AB"]]) {
      expect(validate({ path: "a.ts", edits: [{ ...baseEdit, range }] })).toBe(false);
    }
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
            intent: "Replace the sample greeting with the requested text.",
            rationale: "The visible call should show only the required provenance fields for this edit.",
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
    expect(rendered).toContain("Edit 1");
    expect(rendered).toContain("Intent: Replace the sample greeting with the requested text.");
    expect(rendered).toContain("Rationale: The visible call should show only the required provenance fields for this edit.");
    expect(rendered).not.toContain("Confidence");
    expect(rendered).toContain("--------------");
  });

  it("executes full endpoint replace through the normal path", async () => {
    await withTempFile("sample.txt", "aaa\nbbb\nccc\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");
      const lines = ["aaa", "bbb", "ccc"];
      const ref = `2${computePublicLineChecksum(lines, 2)}│bbb`;

      const result = await editTool.execute(
        "e1",
        {
          path: "sample.txt",
          edits: [
            {
              range: [ref, ref],
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
      const lines = ["aaa", "bbb", "ccc"];
      const ref = `2${computePublicLineChecksum(lines, 2)}│bbb`;
      const editArgs = {
        path: "sample.txt",
        edits: [
          {
            range: [ref, ref],
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
  it("rejects compact and plain refs at execution time", async () => {
    await withTempFile("sample.txt", "aaa\nbbb\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");

      await expect(
        editTool.execute(
          "e1",
          {
            path: "sample.txt",
            edits: [{ range: ["2b", "2b"], lines: ["BBB"] }],
          },
          undefined,
          undefined,
          { cwd } as any,
        ),
      ).rejects.toThrow(/E_FULL_REF_REQUIRED/);

      await expect(
        editTool.execute(
          "e2",
          {
            path: "sample.txt",
            edits: [{ range: ["2", "2"], lines: ["BBB"] }],
          },
          undefined,
          undefined,
          { cwd } as any,
        ),
      ).rejects.toThrow(/E_FULL_REF_REQUIRED/);

      expect(await readFile(path, "utf-8")).toBe("aaa\nbbb\n");
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

  it("accepts endpoint content containing the separator character", async () => {
    await withTempFile("sample.txt", "aaa\nconst text = \"a│b\";\nccc\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");
      const lines = ["aaa", "const text = \"a│b\";", "ccc"];
      const ref = `2${computePublicLineChecksum(lines, 2)}│const text = \"a│b\";`;

      await editTool.execute(
        "e1",
        {
          path: "sample.txt",
          edits: [{ range: [ref, ref], lines: ["const text = \"updated│value\";"] }],
        },
        undefined,
        undefined,
        { cwd } as any,
      );

      expect(await readFile(path, "utf-8")).toBe("aaa\nconst text = \"updated│value\";\nccc\n");
    });
  });

  it("accepts full endpoint refs for blank lines", async () => {
    await withTempFile("sample.txt", "aaa\n\nccc\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");
      const lines = ["aaa", "", "ccc"];
      const ref = `2${computePublicLineChecksum(lines, 2)}│`;

      await editTool.execute(
        "e1",
        {
          path: "sample.txt",
          edits: [{ range: [ref, ref], lines: ["bbb"] }],
        },
        undefined,
        undefined,
        { cwd } as any,
      );

      expect(await readFile(path, "utf-8")).toBe("aaa\nbbb\nccc\n");
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

  it("allows a stale public checksum when the same-numbered endpoint content still matches", async () => {
    await withTempFile("sample.txt", "AAA\nbbb\nccc\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");
      const originalLines = ["aaa", "bbb", "ccc"];
      const staleRef = `2${computePublicLineChecksum(originalLines, 2)}│bbb`;

      const result = await editTool.execute(
        "e1",
        {
          path: "sample.txt",
          edits: [{ range: [staleRef, staleRef], lines: ["BBB"] }],
        },
        undefined,
        undefined,
        { cwd } as any,
      );

      expect(await readFile(path, "utf-8")).toBe("AAA\nBBB\nccc\n");
      const text = result.content?.[0]?.text ?? "";
      expect(text).toContain("W_STALE_CONTEXT");
      expect(result.details?.metrics?.warnings).toBeGreaterThan(0);
    });
  });

  it("rejects stale public checksum when endpoint content moved off the same line", async () => {
    await withTempFile("sample.txt", "aaa\nxxx\nbbb\nccc\n", async ({ cwd, path }) => {
      const { pi, getTool } = makeFakePiRegistry();
      registerEditTool(pi);
      const editTool = getTool("edit");
      const originalLines = ["aaa", "bbb", "ccc"];
      const staleRef = `2${computePublicLineChecksum(originalLines, 2)}│bbb`;

      await expect(
        editTool.execute(
          "e1",
          {
            path: "sample.txt",
            edits: [{ range: [staleRef, staleRef], lines: ["BBB"] }],
          },
          undefined,
          undefined,
          { cwd } as any,
        ),
      ).rejects.toThrow(/E_LINE_CONTENT_MISMATCH/);
      expect(await readFile(path, "utf-8")).toBe("aaa\nxxx\nbbb\nccc\n");
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
              { range: ["1a│a", "1a│a"], lines: ["A"] },
              { range: ["2b│b", "2b│b"], lines: ["B"] },
              { range: ["3c│c", "3c│c"], lines: ["C"] },
              { range: ["4d│d", "4d│d"], lines: ["D"] },
            ],
          },
          undefined,
          undefined,
          { cwd } as any,
        ),
      ).rejects.toThrow(/E_TOO_MANY_EDITS.*You sent 4 edits.*accepts 1-3 edits.*Retry with edits 1-3/s);
    });
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
            edits: [{ range: ["1a│", "1a│"], lines: ["hello"] }],
          },
          undefined,
          undefined,
          { cwd } as any,
        ),
      ).rejects.toThrow(/\[E_EMPTY_FILE\]/);
    });
  });
