Patch a UTF-8 text file using line ranges.

Submit one `edit` call per file. Default limit: at most 3 edit entries per call; split larger changes into smaller calls.

Each edit entry replaces an inclusive line range and must include concise provenance:
```json
{
  "range": [start, end],
  "lines": [...],
  "intent": "Semantic goal this edit serves.",
  "rationale": "Why this edit is justified."
}
```
- `range` — `[start, end]` pair. Prefer full checked lines copied from recent `read` or diff output, e.g. `["42f│const value = 1;", "44q│}"]`.
  Compact checked refs like `"42f"` and plain 1-based line numbers like `"42"` are accepted as fallbacks.
  When full endpoint content is supplied, it must match the current endpoint line after trimming outer whitespace.
- `lines` — new content replacing exactly the range (string array). Use `[]` to delete.
  Must be literal file content, not `LINEc│`-prefixed output. Match indentation exactly.
- `intent` — required concise statement of the semantic goal this edit serves. Do not merely restate the literal line change.
- `rationale` — required concise justification for this edit, focusing on user requirements, evidence, constraints, or assumptions not obvious from the diff.

Example:
```json
{ "path": "src/main.ts", "edits": [
  {
    "range": ["20b│function foo() {", "22m│}"],
    "lines": ["function foo() {", "  return 42;", "}"],
    "intent": "Make foo return the sentinel value expected by callers.",
    "rationale": "The caller contract requires 42 here; this range is the complete function body."
  }
] }
```

Rules:
- Prefer copied full endpoint lines like `128f│    return value`; they make wrong range endpoints easier to catch.
- Do not include neighboring context lines in `lines` unless the range includes those lines.
- Do not emit overlapping or adjacent edits — merge them into one, or split into separate calls if that would exceed 3 edits.
- Do not omit `intent` or `rationale`; metadata strings must not be empty.
