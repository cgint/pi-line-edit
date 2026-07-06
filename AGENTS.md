# Repository Guidelines

## Project Structure & Module Organization
- `index.ts` is the extension entrypoint; it registers the custom `read`/`edit` tools and optional compatibility notifications.
- `src/` contains the implementation, split by responsibility: `read.ts`, `edit.ts`, `hashline.ts`, `edit-diff.ts`, `file-kind.ts`, `fs-write.ts`, and small runtime/path helpers.
- `tool-descriptions/` holds the Markdown prompt text loaded by the tools at runtime.
- `test/` mirrors the code layout: `core/` for hashline primitives, `tools/` for tool behavior, `extension/` for registration/notifications, `integration/` for end-to-end flows, and `support/fixtures.ts` for temp-file helpers.
- `assets/` is documentation media only.

## Build, Test, and Development Commands
- `npm install` — install dependencies.
- `npm test` — run the full test suite with `vitest`.
- `npm test -- test/tools` — run tool-facing tests while iterating on `read`/`edit` behavior.
- `npm test -- test/integration/strict-hashline-loop.test.ts` — run the strict hashline integration scenario.
- There is no separate build step today; Pi loads the TypeScript entrypoints directly from `index.ts`.

## Coding Style & Naming Conventions
- Use TypeScript with ESM imports, two-space indentation, double quotes, and semicolons to match the existing codebase.
- Keep modules narrow and named by responsibility (`fs-write.ts`, `compatibility-notify.ts`).
- Export typed functions and use specific error paths; avoid broad refactors or speculative abstractions.
- No ESLint or Prettier config is checked in, so preserve local style and keep diffs tight.

## Testing Guidelines
- Write tests with `vitest` and place them under the matching `test/` subfolder.
- Name files `<feature>.test.ts`; group assertions around one behavior per `describe` block.
- Any change to anchor parsing, diff preview, compatibility mode, or atomic writes should include or update tests in the affected layer.
- New integration scenarios (e.g. compound edits, stale-position edge cases) go under `test/integration/` as standalone `<scenario>.test.ts` files.

## Commit & Pull Request Guidelines
- Follow the existing Conventional Commit pattern: `fix(hashline): ...`, `refactor(read, edit): ...`, `docs: ...`.
- Keep commits focused and imperative; separate behavior changes from documentation-only updates.
- PRs should summarize the user-visible effect, list the tests run, and include before/after snippets when tool output or prompts change.

## Architecture Guardrails
- Keep `read`, `edit`, prompt text, and tests in sync whenever the hashline format changes.
- Do not bypass `src/fs-write.ts`; atomic writes are part of the extension’s safety guarantees.
- Preserve stale-anchor rejection semantics unless the change explicitly redesigns the protocol.
- Do not introduce autocorrection heuristics into `applyHashlineEdits`. The runtime must not silently patch model errors — if the model sends wrong content, reject or warn, don't fix.
- Keep tool output token-efficient.
- Prompt clarity and model guidance that prevents errors pays for its token cost. When in doubt, teach the model how the tool's fields compose.

## Precommit checks (CRUCIAL — must be green before every commit)

```bash
npm run precommit
```

Runs: `tsc --noEmit` → `npm run test` → `npm audit --audit-level=moderate` → all must pass.

## Regular maintenance

### Dependency refresh (run monthly or before releases)

```bash
bash ~/.local/bin/node_update_reinstall.sh
npm run precommit
```

Resets `node_modules` + lockfile, upgrades to latest semver-compatible versions, and runs audit. Keeps transitive vulnerabilities from accumulating.

### Current vulnerability status

Last checked: 2026-07-06 — **0 vulnerabilities** (after upgrading `@earendil-works/pi-coding-agent` from `^0.74.0` to `^0.80.3`).
