Patch a UTF-8 text file using line ranges.

Submit one `edit` call per file. Default limit: at most 3 edit entries per call; split larger changes into smaller calls.

Each edit entry replaces an inclusive line range:
```json
{
  "range": [start, end],
  "lines": [...]
}
```
- `range` — `[start, end]` pair. Must use full checked endpoint lines copied from recent `read` or diff output, e.g. `["42f│const value = 1;", "44q│}"]`.
  Compact checked refs like `"42f"` and plain line numbers like `"42"` are rejected.
  Endpoint content must match the current endpoint line after trimming outer whitespace; if only surrounding context changed, the edit may proceed with a stale-context warning.
- `lines` — new content replacing exactly the range (string array). Use `[]` to delete.
  Must be literal file content, not `LINEc│`-prefixed output. Match indentation exactly.

Example:
```json
{ "path": "src/main.ts", "edits": [
  {
    "range": ["20b│function foo() {", "22m│}"],
    "lines": ["function foo() {", "  return 42;", "}"]
  }
] }
```

Rules:
- Always copy full endpoint lines like `128f│    return value`; compact refs and plain line numbers are not accepted.
- Do not include neighboring context lines in `lines` unless the range includes those lines.
- Do not emit overlapping or adjacent edits — merge them into one, or split into separate calls if that would exceed 3 edits.