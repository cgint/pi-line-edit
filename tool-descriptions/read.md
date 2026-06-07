Read a UTF-8 text file or a supported image. Text lines are prefixed `LINE│content`; use those visible 1-based line numbers in `edit` ranges.

Use `offset` and `limit` to page through. Default cap: {{DEFAULT_MAX_LINES}} lines or {{DEFAULT_MAX_BYTES}}; when truncated, the tail of the output tells you the next `offset`.

Set `raw: true` to skip line-number prefixing and return plain text. This saves tokens for exploration, documentation, and reference reads.
