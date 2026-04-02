# Copilot Instructions — seclai-javascript

## Build & Lint Pipeline

```sh
npm run build    # tsup — produces CJS, ESM, and DTS bundles
npm test         # vitest
```

## Quality gates (must pass to report completion)

- **ALL tests must pass with ZERO failures. No exceptions.** CI/CD runs the full test suite on every PR. A test failure blocks the build.
- **`npm run build` must succeed with ZERO errors.** The DTS build is strict — type errors in `.d.ts` generation will fail the build even if runtime JS works fine.
- **Do not dismiss test or build failures as pre-existing or unrelated.** The `main` branch CI/CD is green. Any failure on a feature branch was caused by changes on that branch.
- **CRITICAL — NEVER INVESTIGATE ERROR ORIGIN OR BLAME**: When a type, build, or test error appears, **fix it immediately**. Do NOT run `git blame` or use git history to argue that an error is "pre-existing" or not your responsibility. Tools like `git diff`, `git log`, and `git show` may be used to understand and review changes, but never to avoid fixing an error. There is no scenario where knowing the origin of an error changes what you must do: **fix it**.
- **CRITICAL — NEVER PIPE TEST OR BUILD OUTPUT**: Do not append `| tail`, `| head`, `| grep`, or any pipe to `npm test`, `npm run build`, or similar commands. Piping hides errors. Always run with full unfiltered output.

## Key Rules

- After ANY change to `openapi/seclai.openapi.json`, run `npm run generate` to regenerate `src/openapi.ts`. Forgetting this causes type errors in the DTS build.
- `src/types.ts` maps user-facing type aliases to `components["schemas"][...]`. Schema names can change between API versions (e.g. `routers__api__*__` prefixes may be added or removed). Verify names against `src/openapi.ts` after regeneration.
- `tsconfig.json` uses `exactOptionalPropertyTypes: true` — optional properties must use `prop?: T | undefined`, not just `prop?: T`.
- The OpenAPI spec here is NOT identical to `seclai-go`/`seclai-python` (different version baseline). Apply equivalent description changes separately.
- OpenAPI specs are generated from the main `seclai` app repo. Description or endpoint changes made here must also be applied upstream, or they will be overwritten on the next generation.
- `.github/copilot-instructions.md` shares common sections (quality gates, git rules, editing rules, self-correction rules) across all SDK repos. When updating shared rules, apply the same change to all repos: `seclai-python`, `seclai-javascript`, `seclai-go`, `seclai-csharp`, `seclai-cli`, `seclai-mcp`.
- `writeSsoCache` uses atomic rename; on Windows, must `fs.unlink` the destination before `fs.rename`.
- Auth: streaming methods must use resolved auth headers, not `this.apiKey` directly.
- Do not run ad-hoc scripts; add tests instead.

## Git rules

- **NEVER use `git stash`.** Use `git diff`, `git log`, or `git show` instead.
- Do not run `git checkout` to switch branches, `git reset`, or any other destructive git operation without explicit user approval.

## Editing rules

- Do not use CLI text tools (sed/awk). Use the editor-based patch tool.

## Self-correction rules

- **NEVER promise to "do better" without updating these instruction files.** If a recurring mistake is identified, edit this file with a concrete rule that prevents the mistake. Do that FIRST, then continue work.
