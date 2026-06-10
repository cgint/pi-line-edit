Patch a UTF-8 text file using line ranges.

Submit one `edit` call per file. Default limit: at most 3 edit entries per call; split larger changes into smaller calls.

Each edit entry replaces an inclusive line range and must include edit provenance:
```json
{
  "range": [start, end],
  "lines": [...],
  "intent": "What this edit is trying to accomplish.",
  "rationale": "Why this edit is appropriate.",
  "confidence": 7,
  "confidenceReason": "Why this confidence score is justified, including evidence and uncertainty."
}
```
- `range` — `[start, end]` pair. Prefer full checked lines copied from recent `read` or diff output, e.g. `["42f│const value = 1;", "44q│}"]`.
  Compact checked refs like `"42f"` and plain 1-based line numbers like `"42"` are accepted as fallbacks.
  When full endpoint content is supplied, it must match the current endpoint line after trimming outer whitespace.
- `lines` — new content replacing exactly the range (string array). Use `[]` to delete.
  Must be literal file content, not `LINEc│`-prefixed output. Match indentation exactly.
- `intent` — required non-empty statement of what this edit is trying to accomplish.
- `rationale` — required non-empty explanation of why this edit is appropriate.
- `confidence` — required integer from 0 to 10. It is a self-assessment, not a probability.
- `confidenceReason` — required non-empty argument for the confidence score, including evidence and uncertainty. A confidence of 10 must be justified with concrete verification, an exact mechanical edit, or an exact local pattern.

Example:
```json
{ "path": "src/main.ts", "edits": [
  {
    "range": ["20b│function foo() {", "22m│}"],
    "lines": ["function foo() {", "  return 42;", "}"],
    "intent": "Replace foo with the expected constant return.",
    "rationale": "The caller expects foo to return the sentinel value 42.",
    "confidence": 8,
    "confidenceReason": "The range endpoints were copied from the latest read output."
  }
] }
```

Rules:
- Prefer copied full endpoint lines like `128f│    return value`; they make wrong range endpoints easier to catch.
- Do not include neighboring context lines in `lines` unless the range includes those lines.
- Do not emit overlapping or adjacent edits — merge them into one, or split into separate calls if that would exceed 3 edits.
- Do not omit `intent`, `rationale`, `confidence`, or `confidenceReason`; metadata strings must not be empty.
