import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createWriteTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFileSync } from "fs";

const WRITE_DESC = readFileSync(
  new URL("../tool-descriptions/write.md", import.meta.url),
  "utf-8",
).trim();

const WRITE_PROMPT_SNIPPET = readFileSync(
  new URL("../tool-descriptions/write-snippet.md", import.meta.url),
  "utf-8",
).trim();

export const writeToolSchema = Type.Object(
  {
    path: Type.String({
      description: "Path to the file to write to",
    }),
    content: Type.String({
      description: "Content to write to the file",
    }),
    intent: Type.String({
      minLength: 1,
      description: "Required non-empty statement of what this write is trying to accomplish.",
    }),
    rationale: Type.String({
      minLength: 1,
      description: "Required non-empty explanation of why this write is appropriate.",
    }),
    confidence: Type.Integer({
      minimum: 0,
      maximum: 10,
      description: "Required integer self-assessed confidence score from 0 to 10. A score of 10 must be justified by the confidenceReason argument.",
    }),
    confidenceReason: Type.String({
      minLength: 1,
      description: "Required non-empty argument for the confidence score, including evidence and uncertainty. For confidence 10, explain the concrete verification, exact mechanical nature, or exact local pattern that justifies maximum confidence.",
    }),
  },
  { additionalProperties: false },
);

type WriteRequestParams = {
  path: string;
  content: string;
  intent: string;
  rationale: string;
  confidence: number;
  confidenceReason: string;
};

export function assertWriteRequest(request: unknown): asserts request is WriteRequestParams {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    throw new Error("Write request must be an object.");
  }
  const candidate = request as Record<string, unknown>;
  if (typeof candidate.path !== "string" || candidate.path.length === 0) {
    throw new Error('Write request requires a non-empty "path" string.');
  }
  if (typeof candidate.content !== "string") {
    throw new Error('Write request requires a "content" string.');
  }
}

function formatWriteProvenance(
  args: Partial<WriteRequestParams> | undefined,
  theme: { bold: (text: string) => string; fg: (token: string, text: string) => string },
): string | undefined {
  if (!args) return undefined;

  const intent = typeof args.intent === "string" ? args.intent : undefined;
  const rationale = typeof args.rationale === "string" ? args.rationale : undefined;
  const confidence = typeof args.confidence === "number" ? args.confidence : undefined;
  const confidenceReason = typeof args.confidenceReason === "string" ? args.confidenceReason : undefined;

  if (
    intent === undefined &&
    rationale === undefined &&
    confidence === undefined &&
    confidenceReason === undefined
  ) {
    return undefined;
  }

  const header = confidence !== undefined
    ? `Write confidence: ${confidence}/10`
    : "Write provenance";
  const lines = [`${theme.bold(header)}`];
  if (intent !== undefined) lines.push(`  Intent: ${intent}`);
  if (rationale !== undefined) lines.push(`  Rationale: ${rationale}`);
  if (confidenceReason !== undefined) {
    lines.push(`  Confidence reason: ${confidenceReason}`);
  }

  return `${theme.fg("toolOutput", theme.bold("Write provenance:"))}\n${lines.join("\n")}\n--------------`;
}

function formatWriteCall(
  args: Partial<WriteRequestParams> | undefined,
  theme: { bold: (text: string) => string; fg: (token: string, text: string) => string },
): string {
  const path = args?.path;
  const pathDisplay =
    typeof path === "string" && path.length > 0
      ? theme.fg("accent", path)
      : theme.fg("toolOutput", "...");
  const lineCount = typeof args?.content === "string" ? args.content.split("\n").length : 0;
  const lineInfo = lineCount > 0 ? theme.fg("muted", ` (${lineCount} lines)`) : "";
  let text = `${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay}${lineInfo}`;

  const provenance = formatWriteProvenance(args, theme);
  if (provenance) {
    text += `\n\n${provenance}`;
  }

  return text;
}

type WriteToolDefinition = ToolDefinition<typeof writeToolSchema> & { renderShell?: "default" | "self" };

const writeToolDefinition: WriteToolDefinition = {
  name: "write",
  label: "Write",
  description: WRITE_DESC,
  parameters: writeToolSchema,
  promptSnippet: WRITE_PROMPT_SNIPPET,
  renderShell: "default",

  renderCall(args, theme, context) {
    const text = context.lastComponent instanceof Text
      ? context.lastComponent
      : new Text("", 0, 0);
    text.setText(formatWriteCall(args, theme));
    return text;
  },

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    assertWriteRequest(params);
    const builtinWrite = createWriteTool(ctx.cwd);
    return builtinWrite.execute(
      toolCallId,
      { path: params.path, content: params.content },
      signal,
      onUpdate,
    );
  },
};

export function registerWriteTool(pi: ExtensionAPI): void {
  pi.registerTool(writeToolDefinition);
}
