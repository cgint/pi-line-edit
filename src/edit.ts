import { Text } from "@earendil-works/pi-tui";
import { type ThemeColor } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { readFileSync } from "fs";
import { access as fsAccess } from "fs/promises";
import {
  detectLineEnding,
  generateDiffString,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./edit-diff";
import { resolveMutationTargetPath, writeFileAtomically } from "./fs-write";
import {
  applyHashlineEdits,
  computeLineHash,
  resolveEditAnchors,
  type HashlineToolEdit,
  ANCHOR_SEP,
  CONTENT_SEP,
} from "./hashline";
import { loadFileKindAndText } from "./file-kind";
import { resolveToCwd } from "./path-utils";

import { throwIfAborted } from "./runtime";
import { getFileSnapshot } from "./snapshot";
import { buildChangedResponse, buildNoopResponse } from "./edit-response";
import { setLastEdit } from "./undo";
import { computePublicLineChecksum, getVisibleLineCount, parsePublicLineRef } from "./line-ref";

const FULL_ENDPOINT_REF_PATTERN = String.raw`^\s*[>+\-]*\s*\d+(?:[a-z]|#[0-9A-F]{2})\s*[│|]`;

function makeEditEntrySchema() {
  return Type.Object(
    {
      range: Type.Array(Type.String({ minLength: 1, pattern: FULL_ENDPOINT_REF_PATTERN }), {
        minItems: 2,
        maxItems: 2,
        description: `Inclusive line range [start, end]. Must use full checked endpoint lines copied from recent read or diff output, e.g. ["42f│const value = 1;", "44q│}"]. Compact refs like "42f" and plain line numbers like "42" are rejected.`,
      }),
      lines: Type.Array(Type.String(), {
        description: "New content lines. Use [] to delete.",
      }),
    },
    { additionalProperties: false },
  );
}

export const hashlineEditToolSchema = Type.Object(
  {
    path: Type.String({ description: "path" }),
    edits: Type.Array(makeEditEntrySchema(), {
      minItems: 1,
      maxItems: 3,
      description: `REQUIRED: 1-3 edit entries only. Split larger changes into multiple edit calls. Each edit replaces the inclusive line range [start, end] with lines. Range endpoints must be full read-output endpoint lines; use [] to delete.`,
    }),
  },
  { additionalProperties: false },
);


type EditRequestParams = {
  path: string;
  edits: Record<string, unknown>[];
};

type EditMetrics = {
  edits_attempted: number;
  edits_noop: number;
  warnings: number;
  classification: "applied" | "noop";
  added_lines?: number;
  removed_lines?: number;
};

type HashlineEditToolDetails = {
  diff: string;
  snapshotId?: string;
  classification?: "noop";
  metrics?: EditMetrics;
  package: { name: string; version: string };
};

const EDIT_DESC = readFileSync(
  new URL("../tool-descriptions/edit.md", import.meta.url),
  "utf-8",
).trim();

const EDIT_PROMPT_SNIPPET = readFileSync(
  new URL("../tool-descriptions/edit-snippet.md", import.meta.url),
  "utf-8",
).trim();
const DEFAULT_MAX_EDITS_PER_CALL = 3;

type EditBehaviorOptions = {
  validateContentHint: boolean;
  maxEditsPerCall?: number;
};

function enforceEditCountLimit(edits: Record<string, unknown>[], maxEditsPerCall: number | undefined): void {
  if (maxEditsPerCall !== undefined && edits.length > maxEditsPerCall) {
    throw new Error(
      `[E_TOO_MANY_EDITS] You sent ${edits.length} edits. The default edit tool accepts 1-${maxEditsPerCall} edits per call. Retry with edits 1-${maxEditsPerCall} first, then send the remaining edit(s) in a second edit call.`,
    );
  }
}

function normalizedContentHint(value: string): string {
  return value.trim();
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Safety net for environments where AJV validation is disabled.
// Field-type and schema validation are AJV's responsibility;
// only prevent crashes from missing required top-level fields.
// Path existence is checked in execute() once CWD is available.
export function assertEditRequest(
  request: unknown,
  options: { maxEditsPerCall?: number } = {},
): asserts request is EditRequestParams {
  if (!isRecord(request)) {
    throw new Error("Edit request must be an object.");
  }
  if (typeof request.path !== "string" || request.path.length === 0) {
    throw new Error('Edit request requires a non-empty "path" string.');
  }
  if (!Array.isArray(request.edits) || request.edits.length === 0) {
    throw new Error('Edit request requires a non-empty "edits" array.');
  }
  enforceEditCountLimit(request.edits as Record<string, unknown>[], options.maxEditsPerCall);
}

export function normalizeEditItems(edits: Record<string, unknown>[]): HashlineToolEdit[] {
  return edits.map((edit) => {
    const [pos, end] = (edit.range as [string, string]) || ["", ""];
    return { op: "replace", pos, end, lines: (edit.lines as string[]) || [] };
  });
}

function hasEndpointContent(ref: string): boolean {
  return ref.includes(CONTENT_SEP) || ref.includes("|");
}

function anchorPublicLineRef(
  ref: string | undefined,
  fileLines: string[],
  visibleLineCount: number,
  label: "range start" | "range end",
  options: Pick<EditBehaviorOptions, "validateContentHint">,
  warnings: string[],
): string | undefined {
  if (typeof ref !== "string") return ref;
  if (!hasEndpointContent(ref)) {
    throw new Error(
      `[E_FULL_REF_REQUIRED] ${label} must be a full checked endpoint line copied from read or diff output, e.g. "42f${CONTENT_SEP}const value = 1;". Compact refs and plain line numbers are rejected.`,
    );
  }

  const parsed = parsePublicLineRef(ref);
  if (!parsed) return ref;

  const { line, checksum, contentHint } = parsed;
  if (line < 1 || line > visibleLineCount) {
    throw new Error(
      `[E_RANGE_OOB] ${label} line ${line} does not exist (file has ${visibleLineCount} lines). Use a full checked endpoint line from current read output.`,
    );
  }

  if (options.validateContentHint) {
    const expected = normalizedContentHint(contentHint ?? "");
    const actual = normalizedContentHint(fileLines[line - 1] ?? "");
    if (expected !== actual) {
      throw new Error(
        `[E_LINE_CONTENT_MISMATCH] ${label} ${line}${checksum ?? ""} includes endpoint content that does not match current line ${line} after trimming. Given: ${JSON.stringify(expected)}. Current: ${JSON.stringify(actual)}. Re-read this region and retry with the updated full endpoint line.`,
      );
    }
  }

  if (checksum !== undefined) {
    const actualChecksum = computePublicLineChecksum(fileLines, line);
    if (checksum !== actualChecksum) {
      warnings.push(
        `[W_STALE_CONTEXT] ${label} ${line}${checksum} context checksum changed to ${line}${actualChecksum}, but endpoint content still matches; proceeding with the current checked line.`,
      );
    }
  }

  return `${line}${ANCHOR_SEP}${computeLineHash(fileLines, line - 1)}`;
}

function anchorBareLineNumberEdits(
  edits: HashlineToolEdit[],
  content: string,
  options: Pick<EditBehaviorOptions, "validateContentHint">,
  warnings: string[] = [],
): { edits: HashlineToolEdit[]; warnings: string[] } {
  const fileLines = content.split("\n");
  const visibleLineCount = getVisibleLineCount(content);

  return {
    warnings,
    edits: edits.map((edit) => ({
      ...edit,
      pos: anchorPublicLineRef(edit.pos, fileLines, visibleLineCount, "range start", options, warnings) ?? edit.pos,
      end: anchorPublicLineRef(edit.end, fileLines, visibleLineCount, "range end", options, warnings),
    })),
  };
}

type EditTargetResult =
  | { ok: false; error: string; code?: string }
  | {
      ok: true;
      normalized: string;
      bom: string;
      ending: "\r\n" | "\n";
    };

async function resolveEditTarget(
  absolutePath: string,
  path: string,
  accessMode: number,
): Promise<EditTargetResult> {
  try {
    await fsAccess(absolutePath, accessMode);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, error: `File not found: ${path}` };
    }
    if (code === "EACCES" || code === "EPERM") {
      const action = accessMode & constants.W_OK ? "writable" : "readable";
      return { ok: false, error: `File is not ${action}: ${path}` };
    }
    return { ok: false, error: `Cannot access file: ${path}` };
  }

  const file = await loadFileKindAndText(absolutePath);
  if (file.kind === "directory") {
    return {
      ok: false,
      error: `Path is a directory: ${path}. Use ls to inspect directories.`,
    };
  }
  if (file.kind === "image") {
    return {
      ok: false,
      error: `Path is an image file: ${path}. Hashline edit only supports text files.`,
    };
  }
  if (file.kind === "binary") {
    return {
      ok: false,
      error: `Path is a binary file: ${path} (${file.description}). Hashline edit only supports text files.`,
    };
  }

  const { bom, text: content } = stripBom(file.text);
  const normalized = normalizeToLF(content);
  if (normalized.length === 0) {
    return {
      ok: false,
      code: "E_EMPTY_FILE",
      error: `File is empty: ${path}. The edit tool requires an existing line reference from read output; use the write tool to create initial content in an empty file.`,
    };
  }

  return {
    ok: true,
    normalized,
    bom,
    ending: detectLineEnding(content),
  };
}


type EditPreview = { diff: string } | { error: string };
type EditRenderState = {
  argsKey?: string;
  preview?: EditPreview;
  previewGeneration?: number;
};

function getRenderablePreviewInput(args: unknown): EditRequestParams | null {
  if (!isRecord(args) || typeof args.path !== "string") {
    return null;
  }

  const request: EditRequestParams = {
    path: args.path,
    edits: Array.isArray(args.edits) ? args.edits : [],
  };
  return request.edits.length > 0 ? request : null;
}

function colorDiffLines(
  lines: string[],
  theme: { fg: (color: ThemeColor, text: string) => string },
): string[] {
  return lines.map((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return theme.fg("success", line);
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      return theme.fg("error", line);
    }
    return theme.fg("dim", line);
  });
}
function formatPreviewDiff(
  diff: string,
  expanded: boolean,
  theme: { fg: (color: ThemeColor, text: string) => string },
): string {
  const lines = diff.split("\n");
  const maxLines = expanded ? 40 : 16;
  const shown = colorDiffLines(lines.slice(0, maxLines), theme);

  if (lines.length > maxLines) {
    shown.push(theme.fg("muted", `... ${lines.length - maxLines} more diff lines`));
  }
  return shown.join("\n");
}

function formatResultDiff(
  diff: string,
  theme: { fg: (color: ThemeColor, text: string) => string },
): string {
  return colorDiffLines(diff.split("\n"), theme).join("\n");
}
function getRenderedEditTextContent(
  result: { content?: Array<{ type: string; text?: string }> },
): string | undefined {
  const textContent = result.content?.find(
    (entry): entry is { type: "text"; text: string } =>
      entry.type === "text" && typeof entry.text === "string",
  );
  return textContent?.text;
}

function isAppliedChangedResult(
  details: HashlineEditToolDetails | undefined,
): boolean {
  const metrics = details?.metrics;
  return (
    metrics?.classification === "applied" &&
    metrics.added_lines !== undefined &&
    metrics.removed_lines !== undefined
  );
}

function buildAppliedChangedResultText(
  text: string | undefined,
  details: HashlineEditToolDetails | undefined,
  preview: EditPreview | undefined,
  theme: { fg: (color: ThemeColor, text: string) => string },
): string | undefined {
  const previewDiff = preview && !("error" in preview) ? preview.diff : undefined;
  const sections: string[] = [];

  if (details?.diff && details.diff !== previewDiff) {
    sections.push(formatResultDiff(details.diff, theme));
  }

  const warnings = text?.match(/(?:^|\n\n)Warnings:\n[\s\S]*$/)?.[0]?.trimStart();
  if (warnings) sections.push(warnings);

  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

function formatEditCall(
  args: EditRequestParams | undefined,
  state: EditRenderState,
  expanded: boolean,
  theme: {
    bold: (text: string) => string;
    fg: (color: ThemeColor, text: string) => string;
  },
): string {
  const path = args?.path;
  const pathDisplay =
    typeof path === "string" && path.length > 0
      ? theme.fg("accent", path)
      : theme.fg("toolOutput", "...");
  let text = `${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`;

  if (!state.preview) {
    return text;
  }

  if ("error" in state.preview) {
    text += `\n\n${theme.fg("error", state.preview.error)}`;
    return text;
  }

  if (state.preview.diff) {
    text += `\n\n${formatPreviewDiff(state.preview.diff, expanded, theme)}`;
  }
  return text;
}

export async function computeEditPreview(
  request: unknown,
  cwd: string,
  options: EditBehaviorOptions = {
    validateContentHint: true,
    maxEditsPerCall: DEFAULT_MAX_EDITS_PER_CALL,
  },
): Promise<EditPreview> {
  try {
    assertEditRequest(request, options);
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const params = request as EditRequestParams;
  const path = params.path;
  const absolutePath = resolveToCwd(path, cwd);
  const toolEdits = normalizeEditItems(params.edits);

  const target = await resolveEditTarget(absolutePath, path, constants.R_OK);
  if (!target.ok) {
    return { error: target.error };
  }
  const originalNormalized = target.normalized;

  try {
    const anchored = anchorBareLineNumberEdits(toolEdits, originalNormalized, options);
    const resolved = resolveEditAnchors(anchored.edits);
    const result = applyHashlineEdits(originalNormalized, resolved).content;

    if (originalNormalized === result) {
      return {
        error: `No changes made to ${path}. The edits produced identical content.`,
      };
    }

    return { diff: generateDiffString(originalNormalized, result).diff };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

type EditToolDefinition = ToolDefinition<
  typeof hashlineEditToolSchema,
  HashlineEditToolDetails,
  EditRenderState
> & { renderShell?: "default" | "self" };

function makeEditToolDefinition(args: {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  behavior: EditBehaviorOptions;
}): EditToolDefinition {
  return {
    name: args.name,
    label: args.label,
    description: args.description,
    parameters: hashlineEditToolSchema,
    promptSnippet: args.promptSnippet,
    // Force the default tool shell (Box with pending/success/error background) so
    // we don't inherit renderShell: "self" from the built-in edit tool of the
    // same name, which would drop the shared background color block.
    renderShell: "default",
    renderCall(callArgs, theme, context) {
      const previewInput = getRenderablePreviewInput(callArgs);
      if (context.executionStarted) {
        context.state.argsKey = undefined;
        context.state.preview = undefined;
        context.state.previewGeneration = (context.state.previewGeneration ?? 0) + 1;
      } else if (!context.argsComplete || !previewInput) {
        context.state.argsKey = undefined;
        context.state.preview = undefined;
        context.state.previewGeneration = (context.state.previewGeneration ?? 0) + 1;
      } else {
        const argsKey = JSON.stringify(previewInput);
        if (context.state.argsKey !== argsKey) {
          context.state.argsKey = argsKey;
          context.state.preview = undefined;
          const previewGeneration = (context.state.previewGeneration ?? 0) + 1;
          context.state.previewGeneration = previewGeneration;
          computeEditPreview(previewInput, context.cwd, args.behavior)
            .then((preview) => {
              if (
                context.state.argsKey === argsKey &&
                context.state.previewGeneration === previewGeneration
              ) {
                context.state.preview = preview;
                context.invalidate();
              }
            })
            .catch((err: unknown) => {
              if (
                context.state.argsKey === argsKey &&
                context.state.previewGeneration === previewGeneration
              ) {
                context.state.preview = {
                  error: err instanceof Error ? err.message : String(err),
                };
                context.invalidate();
              }
            });
        }
      }
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      text.setText(
        formatEditCall(
          getRenderablePreviewInput(callArgs) ?? undefined,
          context.state as EditRenderState,
          context.expanded,
          theme,
        ),
      );
      return text;
    },

    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) {
        const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
        text.setText(theme.fg("warning", "Editing..."));
        return text;
      }

      const typedResult = result as {
        content?: Array<{ type: string; text?: string }>;
        details?: HashlineEditToolDetails;
      };
      const renderedText = getRenderedEditTextContent(typedResult);

      const renderState = context.state as EditRenderState | undefined;
      const previewBeforeResult = renderState?.preview;
      if (renderState) {
        renderState.preview = undefined;
        renderState.previewGeneration = (renderState.previewGeneration ?? 0) + 1;
      }

      if (context.isError) {
        if (!renderedText) {
          return new Text("", 0, 0);
        }
        const text = context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
        text.setText(`\n${theme.fg("error", renderedText)}`);
        return text;
      }

      if (isAppliedChangedResult(typedResult.details)) {
        const appliedChangedText = buildAppliedChangedResultText(
          renderedText,
          typedResult.details,
          previewBeforeResult,
          theme,
        );
        if (!appliedChangedText) {
          return new Text("", 0, 0);
        }
        const text = context.lastComponent instanceof Text
          ? context.lastComponent
          : new Text("", 0, 0);
        text.setText(appliedChangedText);
        return text;
      }

      if (!renderedText) {
        return new Text("", 0, 0);
      }

      const text = context.lastComponent instanceof Text
        ? context.lastComponent
        : new Text("", 0, 0);
      text.setText(renderedText);
      return text;
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      assertEditRequest(params, args.behavior);

      const path = (params as EditRequestParams).path;
      const absolutePath = resolveToCwd(path, ctx.cwd);
      const toolEdits = normalizeEditItems(
        (params as EditRequestParams).edits,
      );

      const mutationTargetPath = await resolveMutationTargetPath(absolutePath);
      return withFileMutationQueue(mutationTargetPath, async () => {
        throwIfAborted(signal);
        const target = await resolveEditTarget(absolutePath, path, constants.R_OK | constants.W_OK);
        if (!target.ok) {
          const prefix = target.code ? `[${target.code}] ` : "";
          throw new Error(`${prefix}${target.error}`);
        }
        const { bom, normalized: originalNormalized, ending: originalEnding } = target;

        const anchored = anchorBareLineNumberEdits(toolEdits, originalNormalized, args.behavior);
        const resolved = resolveEditAnchors(anchored.edits);

        const anchorResult = applyHashlineEdits(originalNormalized, resolved, signal);
        const result = anchorResult.content;
        const warnings = [...anchored.warnings, ...(anchorResult.warnings ?? [])];
        const originalLineCount = originalNormalized.split("\n").length - (originalNormalized.endsWith("\n") ? 1 : 0);
        if (result.length === 0 && originalLineCount > 50) {
          throw new Error(
            "[E_WOULD_EMPTY] This edit would delete the entire file. The edit tool does not allow full-file deletion for files with more than 50 lines. If you truly intend to clear the file, use the write tool to overwrite it with an empty string.",
          );
        }
        const noopEdits = anchorResult.noopEdits;
        const editsAttempted = toolEdits.length;

        if (originalNormalized === result) {
          const noopSnapshotId = (await getFileSnapshot(absolutePath)).snapshotId;
          return buildNoopResponse({
            path,
            noopEdits,
            originalNormalized,
            snapshotId: noopSnapshotId,
            editsAttempted,
            warnings,
          });
        }
        setLastEdit({ path, previousContent: originalNormalized });
        throwIfAborted(signal);
        await writeFileAtomically(
          absolutePath,
          bom + restoreLineEndings(result, originalEnding),
        );
        const updatedSnapshotId = (await getFileSnapshot(absolutePath)).snapshotId;

        return buildChangedResponse({
          path,
          originalNormalized,
          result,
          warnings,
          snapshotId: updatedSnapshotId,
          editsAttempted,
          noopEditsCount: noopEdits?.length ?? 0,
        });
      });
    },
  };
}

const editToolDefinition: EditToolDefinition = makeEditToolDefinition({
  name: "edit",
  label: "Edit",
  description: EDIT_DESC,
  promptSnippet: EDIT_PROMPT_SNIPPET,
  behavior: {
    validateContentHint: true,
    maxEditsPerCall: DEFAULT_MAX_EDITS_PER_CALL,
  },
});

export function registerEditTool(pi: ExtensionAPI): void {
  pi.registerTool(editToolDefinition);
}
