# pi-line-edit

A [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension for easier file edits using compact **checked line references**.

This is a fork of [`@jerryan/pi-hashline-edit`](https://github.com/JerryAZR/pi-hashline-edit). It keeps the useful safety machinery (atomic writes, mutation queue, binary/image guards, previews, undo support) but changes the model-facing workflow from `LINE#HASH` anchors to compact refs like `128f`.

## Why

The stock `edit` tool requires exact old-text matches. Hashline editing improves stale-context safety, but models can get stuck when they forget or miscopy `LINE#HASH` anchors. This extension optimizes for reliable model behavior:

- `read` shows checked line refs as `LINEc│content`, e.g. `128f│content`
- `edit` accepts checked refs like `["128f", "130q"]` and rejects them if stale
- plain ranges like `["128", "130"]` still work as a weaker fallback
- edit diffs return fresh checked refs for chaining subsequent edits

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
    { "range": ["9m", "9m"], "lines": ["  console.log('pi-line-edit');"] }
  ]
}
```

Replace a range:

```json
{
  "path": "src/main.ts",
  "edits": [
    { "range": ["20a", "25z"], "lines": ["function foo() {", "  return 42;", "}"] }
  ]
}
```

Delete lines:

```json
{
  "path": "src/main.ts",
  "edits": [
    { "range": ["30b", "33x"], "lines": [] }
  ]
}
```

All edits in a single call validate against the same pre-edit snapshot and apply bottom-up, so checked refs stay consistent across operations. Bare line numbers resolve against current file contents and intentionally skip checksum validation.

## Diff output

Edit results return fresh checked refs in a clean line-numbered diff:

```diff
 8k│function hello() {
-9m│  console.log("world");
+9v│  console.log("pi-line-edit");
10p│}
```

## Notes

- `range` values are strings so they can carry the optional one-letter checksum suffix.
- Prefer copied checked refs like `128f`; plain line numbers like `128` are accepted but have weaker stale-line protection.
- `raw: true` on `read` returns plain text without checked line prefixes.

## Credits

Based on [`JerryAZR/pi-hashline-edit`](https://github.com/JerryAZR/pi-hashline-edit), itself based on the original hashline concept from [`oh-my-pi`](https://github.com/can1357/oh-my-pi).

## License

MIT. See [LICENSE](LICENSE).
