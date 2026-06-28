Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.

```json
{
  "path": "src/main.ts",
  "content": "export const value = 42;\n"
}
```

Fields:
- `path` — file to create or overwrite.
- `content` — complete file content to write.