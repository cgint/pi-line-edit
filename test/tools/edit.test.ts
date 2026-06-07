import { describe, expect, it } from "vitest";
import { readFile } from "fs/promises";
import Ajv from "ajv";
import {
  assertEditRequest,
  hashlineEditToolSchema,
  registerEditTool,
} from "../../src/edit";
import { computeLineHash } from "../../src/hashline";
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
      expect(rendered).toContain(`[success]+2│BBB[/success]`);
      expect(rendered).not.toContain("Updated sample.txt");
      expect(rendered).not.toContain("```text");
      expect(result.details?.diff).toContain("+2");
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
            edits: [{ range: ["1#AB", "1#AB"], lines: ["hello"] }],
          },
          undefined,
          undefined,
          { cwd } as any,
        ),
      ).rejects.toThrow(/\[E_EMPTY_FILE\]/);
    });
  });
