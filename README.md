# pi-line-edit

A [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension for easier file edits by **plain line number ranges**.

This is a fork of [`@jerryan/pi-hashline-edit`](https://github.com/JerryAZR/pi-hashline-edit). It keeps the useful safety machinery (atomic writes, mutation queue, binary/image guards, previews, undo support) but changes the model-facing workflow from hash anchors to simple line numbers.

## Why

The stock `edit` tool requires exact old-text matches. Hashline editing improves stale-context safety, but models can get stuck when they forget to include `LINE#HASH` anchors. This extension optimizes for reliable model behavior:

- `read` shows line numbers as `LINE│content`
- `edit` accepts plain ranges like `["12", "15"]`
- edit diffs show line numbers but no hashes
- `LINE#HASH` anchors are still accepted internally for compatibility when supplied

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
 8│function hello() {
 9│  console.log("world");
10│}
```

### Edit

Replace one line:

```json
{
  "path": "src/main.ts",
  "edits": [
    { "range": ["9", "9"], "lines": ["  console.log('pi-line-edit');"] }
  ]
}
```

Replace a range:

```json
{
  "path": "src/main.ts",
  "edits": [
    { "range": ["20", "25"], "lines": ["function foo() {", "  return 42;", "}"] }
  ]
}
```

Delete lines:

```json
{
  "path": "src/main.ts",
  "edits": [
    { "range": ["30", "33"], "lines": [] }
  ]
}
```

All edits in a single call validate against the same pre-edit snapshot and apply bottom-up, so line numbers stay consistent across operations.

## Diff output

Edit results use a clean line-numbered diff:

```diff
 8│function hello() {
-9│  console.log("world");
+9│  console.log("pi-line-edit");
10│}
```

## Notes

- `range` values are strings because pi tool schemas handle them consistently and this preserves compatibility with upstream `LINE#HASH` anchors.
- Plain line numbers are resolved against the current file contents at execution time.
- `raw: true` on `read` returns plain text without line-number prefixes.

## Credits

Based on [`JerryAZR/pi-hashline-edit`](https://github.com/JerryAZR/pi-hashline-edit), itself based on the original hashline concept from [`oh-my-pi`](https://github.com/can1357/oh-my-pi).

## License

MIT. See [LICENSE](LICENSE).
