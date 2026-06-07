Read a UTF-8 text file or a supported image. Text lines are prefixed `LINEc│content`, where `c` is a one-letter freshness check; use those visible refs in `edit` ranges.

Use `offset` and `limit` to page through. Default cap: {{DEFAULT_MAX_LINES}} lines or {{DEFAULT_MAX_BYTES}}; when truncated, the tail of the output tells you the next `offset`.

Set `raw: true` to skip checked line-ref prefixing and return plain text. This saves tokens for exploration, documentation, and reference reads.
