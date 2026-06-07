Patch a UTF-8 text file using line ranges.

Submit one `edit` call per file. All operations go in a single `edits` array.

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
- `range` — `[start, end]` pair. Prefer checked line refs copied from a recent `read` or diff output, e.g. `["42f", "44q"]`.
  Plain 1-based line numbers are also accepted, e.g. `["42", "42"]` or `["20", "25"]`; they are resolved against the current file contents without checksum validation.
- `lines` — new content replacing the range (string array). Use `[]` to delete.
  Must be literal file content, not `LINEc│`-prefixed output. Match indentation exactly.
- `intent` — required non-empty statement of what this edit is trying to accomplish.
- `rationale` — required non-empty explanation of why this edit is appropriate.
- `confidence` — required integer from 0 to 10. It is a self-assessment, not a probability.
- `confidenceReason` — required non-empty argument for the confidence score, including evidence and uncertainty. A confidence of 10 must be justified with concrete verification, an exact mechanical edit, or an exact local pattern.

Examples:
```json
{ "path": "src/main.ts", "edits": [
  {
    "range": ["12a", "12a"],
    "lines": ["const x = 1;"],
    "intent": "Initialize x with the constant used by the following calculation.",
    "rationale": "The surrounding code reads x immediately and expects a numeric value.",
    "confidence": 7,
    "confidenceReason": "The local data flow supports this edit, but no tests were run for this file."
  },
  {
    "range": ["20b", "25m"],
    "lines": ["function foo() {", "  return 42;", "}"],
    "intent": "Replace the placeholder foo implementation with the expected constant return.",
    "rationale": "The caller expects foo to return the sentinel value 42.",
    "confidence": 8,
    "confidenceReason": "The intended value is documented in the adjacent caller, but this edit has not been verified by a test."
  }
] }
```

Rules:
- Prefer copied checked refs like `128f`; use plain line numbers only when you intentionally want to resolve against current line positions without stale-line checking.
- Do not emit overlapping or adjacent edits — merge them into one.
- Do not omit `intent`, `rationale`, `confidence`, or `confidenceReason`; metadata strings must not be empty.
