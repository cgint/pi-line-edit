Patch a UTF-8 text file using line ranges.

Submit one `edit` call per file. All operations go in a single `edits` array.

Each edit entry replaces an inclusive line range:
```json
{ "range": [start, end], "lines": [...] }
```
- `range` — `[start, end]` pair. Prefer `LINE#HASH` anchors copied from a recent `read` or diff output when available, e.g. `["42#A4", "42#A4"]`.
  Plain 1-based line numbers are also accepted, e.g. `["42", "42"]` or `["20", "25"]`; they are resolved against the current file contents at execution time.
- `lines` — new content replacing the range (string array). Use `[]` to delete.
  Must be literal file content, not LINE#HASH│-prefixed output. Match indentation exactly.

Examples:
```json
{ "path": "src/main.ts", "edits": [
  { "range": ["12", "12"], "lines": ["const x = 1;"] },
  { "range": ["20", "25"], "lines": ["function foo() {", "  return 42;", "}"] }
] }
```

Rules:
- Use plain line numbers when that is simpler. Use `LINE#HASH` anchors when you need stale-context protection.
- Do not emit overlapping or adjacent edits — merge them into one.
