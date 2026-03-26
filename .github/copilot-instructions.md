# Copilot Instructions — seclai-javascript

## Build & Lint Pipeline

```sh
npm run build    # tsup — produces CJS, ESM, and DTS bundles
npm test         # vitest
```

## Key Rules

- After ANY change to `openapi/seclai.openapi.json`, run `npm run generate` to regenerate `src/openapi.ts`. Forgetting this causes type errors in the DTS build.
- `src/types.ts` maps user-facing type aliases to `components["schemas"][...]`. Schema names can change between API versions (e.g. `routers__api__*__` prefixes may be added or removed). Verify names against `src/openapi.ts` after regeneration.
- `tsconfig.json` uses `exactOptionalPropertyTypes: true` — optional properties must use `prop?: T | undefined`, not just `prop?: T`.
- The DTS build is strict — type errors in `.d.ts` generation will fail the build even if runtime JS works fine.
- The OpenAPI spec here is NOT identical to `seclai-go`/`seclai-python` (different version baseline). Apply equivalent description changes separately.
- `writeSsoCache` uses atomic rename; on Windows, must `fs.unlink` the destination before `fs.rename`.
- Auth: streaming methods must use resolved auth headers, not `this.apiKey` directly.
