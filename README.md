# pi-line-edit

A [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension for safer file edits using full **checked endpoint line references**.

This is a fork of [`@jerryan/pi-hashline-edit`](https://github.com/JerryAZR/pi-hashline-edit). It keeps the useful safety machinery (atomic writes, mutation queue, binary/image guards, previews, undo support) but changes the model-facing workflow from `LINE#HASH` anchors to read-output endpoint lines like `128f│content`.

## Why

The stock `edit` tool requires exact old-text matches. Hashline editing improves stale-context safety, but models can get stuck when they forget or miscopy anchors. This extension optimizes for reliable model behavior:

- `read` shows checked endpoint lines as `LINEc│content`, e.g. `128f│content`
- `edit` requires full endpoint refs like `["128f│old", "130q│end"]`
- compact refs like `"128f"` and plain line numbers like `"128"` are rejected
- if only surrounding context changed but endpoint content still matches, `edit` can proceed with a stale-context warning
- edit diffs return fresh checked endpoint refs for chaining subsequent edits

## Installation

From GitHub:

```bash
pi install git:github.com/cgint/pi-line-edit
```

From a local checkout:

```bash
pi install /path/to/pi-line-edit
```

Start a new pi session after installation. Running sessions may need `/reload` or a restart to pick up tool registrations and prompt changes.

## Workflow

### Read

```json
{ "path": "src/main.ts" }
```

Example output:

```text
 8k│function hello() {
 9m│  console.log("world");
10p│}
```

### Edit

Replace one line:

```json
{
  "path": "src/main.ts",
  "edits": [
    {
      "range": ["9m│  console.log(\"world\");", "9m│  console.log(\"world\");"],
      "lines": ["  console.log('pi-line-edit');"],
      "intent": "Update the example greeting output.",
      "rationale": "The README demonstrates replacing exactly one read-output endpoint line."
    }
  ]
}
```

Replace a range:

```json
{
  "path": "src/main.ts",
  "edits": [
    {
      "range": ["20a│function foo() {", "25z│}"],
      "lines": ["function foo() {", "  return 42;", "}"],
      "intent": "Make foo return the documented sentinel value.",
      "rationale": "The selected full endpoint range spans the old function body."
    }
  ]
}
```

Delete lines:

```json
{
  "path": "src/main.ts",
  "edits": [
    {
      "range": ["30b│  debug();", "33x│  trace();"],
      "lines": [],
      "intent": "Remove obsolete debug-only statements.",
      "rationale": "The selected full endpoint range contains only the debug block being removed."
    }
  ]
}
```

All edits in a single call validate against the same pre-edit snapshot and apply bottom-up, so checked refs stay consistent across operations. Compact refs and bare line numbers are rejected; copy the full `LINEc│content` endpoint line from `read` or a prior edit diff.

## Diff output

Edit results return fresh checked refs in a clean line-numbered diff:

```diff
 8k│function hello() {
-9m│  console.log("world");
+9v│  console.log("pi-line-edit");
10p│}
```

## Notes

- `range` values are strings so they can carry the one-letter checksum and endpoint content exactly as shown by `read`.
- Always copy the full endpoint line, e.g. `128f│    return value`; compact refs and plain line numbers are rejected.
- `raw: true` on `read` returns plain text without checked line prefixes, so raw output cannot be used directly as `edit` ranges.

## Credits

Based on [`JerryAZR/pi-hashline-edit`](https://github.com/JerryAZR/pi-hashline-edit), itself based on the original hashline concept from [`oh-my-pi`](https://github.com/can1357/oh-my-pi).

## License

MIT. See [LICENSE](LICENSE).
