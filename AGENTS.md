# Repository Guidelines

## Project Structure
- `src/index.ts` is the userscript entry point: it parses the novel/chapter from the URL, observes the Batch Re-Translate drawer, annotates model rows, injects the Free Retranslate UI, wires the click handler, and registers the userscript-manager menu command.
- `src/retranslate/` contains runtime behavior: `api.ts` (same-origin fetch clients and pure parsers), `candidates.ts` (candidate grouping by AI model), `domIntegration.ts` (drawer badges, the free-retranslate section, and the persistent status pill), `quotas.ts` (free-quota and paid-batch safety guards), `retranslate.ts` (guarded orchestration and free batch execution), and `types.ts` (shared domain types).
- `src/types/userscript.d.ts` declares the userscript-manager globals (`GM_setValue`, `GM_getValue`, `GM_registerMenuCommand`).
- `config/versions.cjs` holds build-time version data consumed by `userscript.metadata.cjs`.
- `userscript.metadata.cjs` is the canonical userscript metadata source; it exposes `getPerformanceHeaders`, `getGreasyForkHeaders`, and `getDevHeaders`.
- `webpack.config.cjs` exports three named builds (performance, greasyfork, dev).
- `dist/` contains generated userscript bundles and metadata listed in `README.md`; treat it as build output.

## Development Commands
- Use Node.js 20.19.0 or newer; `package.json` declares `"node": ">=20.19.0"`.
- `npm install`: Install dependencies; use npm because `package-lock.json` is present.
- `npm run dev`: Start webpack-dev-server for the development userscript/proxy on port 8080.
- `npm run build`: Build all production and development userscript bundles into `dist/`.
- `npm run build:performance`, `npm run build:greasyfork`, `npm run build:devbundle`: Build a single named variation.
- `npm run typecheck`: Run TypeScript checking with `tsc --noEmit`.
- `npm run lint`: Run ESLint against TypeScript source under `src/` and `test/`.
- `npm run test`: Run the Jest test suite under `test/`.
- `npm run validate:userscript`: Validate generated `dist/` artifacts, metadata headers, and URLs.
- `npm run validate`: Run typecheck, lint, test, build, then validate:userscript as the standard local gate.
- Format and single-test commands are not configured in `package.json`; do not invent them.

## Coding Conventions
- Write TypeScript in the style already used: tab indentation, double quotes, no semicolons, and named exports for shared helpers.
- Keep `tsconfig.json` constraints in mind: ES2021 target, ESNext modules, bundler module resolution, and `allowJs: false`.
- Keep userscript-specific globals typed through `src/types/userscript.d.ts`; do not replace GM APIs with browser-only APIs without checking userscript support.
- Follow existing module boundaries: same-origin fetch and parsing belong in `src/retranslate/api.ts`, candidate grouping in `candidates.ts`, DOM/UX in `domIntegration.ts`, guards in `quotas.ts`, orchestration in `retranslate.ts`, and shared shapes in `types.ts`.
- Pure parsers in `api.ts` must stay defensive and side-effect free so they remain unit-testable.

## Testing & Verification
- Use `npm run validate` as the standard completion gate for source or documentation changes that need repo validation.
- Use `npm run typecheck` as the primary lightweight validation command while iterating.
- Use `npm run test` to run the Jest suite; add tests under `test/retranslate/` for any new pure logic in `src/retranslate/`.
- Use `npm run build` when a change affects webpack config, userscript metadata, grants, match patterns, or `dist/` output.
- After build-related changes, inspect generated userscript paths documented in `README.md`: `dist/wtr-lab-retranslate.user.js`, `dist/wtr-lab-retranslate.greasyfork.user.js`, and `dist/wtr-lab-retranslate.dev.user.js`.

## Safety & Change Management
- Preserve unrelated changes; this workspace may contain local debug files that are not part of source edits.
- Use strict Conventional Commits 1.0.0 with no emojis.
- Split unrelated logical concerns into multiple atomic commits by default; use one commit only when the full diff is one logical unit or the user explicitly approves it.
- Do not edit `dist/` by hand unless the task is specifically about generated output; prefer `npm run build`.
- Do not edit `package-lock.json` unless dependencies change, and do not add dependencies, hooks, CI, tests, or formatter/linter configuration unless requested.
- Never bypass WTR Lab quotas or payments, read or store cookies, persist tokens, or introduce cross-origin requests or `@connect` grants.
- Never commit secrets, API keys, tokens, `.env` files, or unredacted debug reports.

## Agent Notes
- Read `README.md` first for user-facing behavior, install/build guidance, and the build-variations table.
- Check `userscript.metadata.cjs` before changing the script name, grants, match patterns, or download/update URLs.
- Check `webpack.config.cjs` before changing bundling or dev-server behavior.
- The free-quota and paid-batch guards in `quotas.ts` are a safety contract: a model absent from the quota map is treated as zero free quota, and an unknown per-chapter cost blocks the batch rather than pricing it at zero.
