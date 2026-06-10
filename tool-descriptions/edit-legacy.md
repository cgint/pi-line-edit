Patch a UTF-8 text file using compact line ranges.

This is the legacy compact-ref edit tool. Prefer the default `edit` tool for new work; use `edit_legacy` only when you intentionally want the older behavior without full endpoint-content validation or the default 3-edit batch limit.

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
- `range` — `[start, end]` pair. Prefer compact checked refs copied from `read` or diff output, e.g. `["42f", "44q"]`.
  Plain 1-based line numbers are accepted as a weaker fallback.
- `lines` — new content replacing exactly the range (string array). Use `[]` to delete.
  Must be literal file content, not `LINEc│`-prefixed output. Match indentation exactly.
- `intent`, `rationale`, `confidence`, and `confidenceReason` are required.

Rules:
- Prefer the default `edit` tool unless compact legacy behavior is specifically needed.
- Do not include neighboring context lines in `lines` unless the range includes those lines.
- Do not emit overlapping edits.
