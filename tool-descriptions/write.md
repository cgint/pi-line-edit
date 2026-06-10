Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.

Writes must include provenance metadata:
```json
{
  "path": "src/main.ts",
  "content": "export const value = 42;\n",
  "intent": "Create the module requested by the user.",
  "rationale": "The file does not exist yet and the requested implementation needs this module.",
  "confidence": 8,
  "confidenceReason": "The content is a direct implementation of the requested module; tests have not been run yet."
}
```

Fields:
- `path` — file to create or overwrite.
- `content` — complete file content to write.
- `intent` — required non-empty statement of what this write is trying to accomplish.
- `rationale` — required non-empty explanation of why this write is appropriate.
- `confidence` — required integer self-assessed confidence score from 0 to 10. A confidence of 10 must be justified with concrete verification, exact mechanical content, or an exact local pattern.
- `confidenceReason` — required non-empty argument for the confidence score, including evidence and uncertainty.
