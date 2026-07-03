<div align="center">

# WTR Lab Retranslate

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg?style=for-the-badge)](https://github.com/MasuRii/wtr-lab-retranslate)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178c6?logo=typescript&logoColor=white&style=for-the-badge)](https://www.typescriptlang.org/)
[![Built with Webpack](https://img.shields.io/badge/Built%20with-Webpack-8DD6F9?logo=webpack&logoColor=white&style=for-the-badge)](https://webpack.js.org/)
[![Install](https://img.shields.io/badge/Install-GitHub-green.svg?style=for-the-badge)](https://raw.githubusercontent.com/MasuRii/wtr-lab-retranslate/main/dist/wtr-lab-retranslate.user.js)
[![GitHub Issues](https://img.shields.io/github/issues/MasuRii/wtr-lab-retranslate?style=for-the-badge)](https://github.com/MasuRii/wtr-lab-retranslate/issues)
[![GitHub Stars](https://img.shields.io/github/stars/MasuRii/wtr-lab-retranslate?style=for-the-badge)](https://github.com/MasuRii/wtr-lab-retranslate/stargazers)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Y8Y01PSSVR)

<img width="332" height="900" alt="image" src="https://github.com/user-attachments/assets/889849eb-7017-4f72-bdf0-f15b156c3605" />

A [WTR-Lab.com](https://wtr-lab.com) userscript that adds a **Free Batch Retranslate** button to the existing Batch Re-Translate drawer — batch-retranslate chapters filtered by model using your free daily quota, with live progress. No tickets are spent, no payment is bypassed, and only same-origin requests are used.

</div>

## Features

### Free Batch Retranslate

- **Free Retranslate Button** — injects a green "Free Retranslate" section into the existing Batch Re-Translate drawer (above the drawer footer) showing your remaining free daily retranslates and a one-click batch button.
- **Batch-Size & Model Filtering** — reads the drawer's selected batch size (e.g. *Next 3 chapters*) and selected model rows, then retranslates only the matching chapters. With no models selected, all chapters in the selected batch range are processed.
- **Free Quota Only** — uses your free daily retranslate quota (`profile/usage`). It never spends tickets and stops as soon as the free quota is exhausted, skipping the remaining chapters.
- **Sequential Execution with Polling** — for each chapter it triggers a free retranslate (`refresh-request`) and polls the real server-assigned task (`reader/task` via `reader/get`) until the chapter completes, with a bounded fallback status check when a Turnstile challenge blocks `reader/get`.
- **Confirmation First** — a native confirm dialog summarizes the batch, model filter, matching chapter count, and free quota before anything is submitted. Nothing runs without an explicit OK.
- **Live Progress** — an in-drawer progress list tracks every chapter (✓ completed, ✗ failed, ⊘ skipped, ⟳ translating), and a small non-blocking status pill pinned to the screen keeps progress visible even if you close the drawer or navigate to another chapter. The pill auto-hides after a few seconds and is click-to-dismiss.

### Drawer Annotation

- **Per-Model Candidate Badges** — annotates each existing `.brt-model-row` with a `.brt-candidate-count` badge showing how many retranslate candidates exist for that model.
- **Accessible Annotation** — each badge is a non-interactive `<span>` with a descriptive `aria-label` (e.g. "3 retranslate candidates for GPT-4o") so screen readers announce the count with full model context.
- **Idempotent Refresh** — re-scanning removes any previous badge before adding a fresh one, so annotations stay correct when the drawer re-opens.
- **Live Drawer Observation** — a debounced `MutationObserver` watches the drawer and refreshes annotations and the free-retranslate button state automatically as the selection changes.

### Safety Guardrails

- **Same-Origin Fetch Only** — all network calls go to same-origin WTR-Lab endpoints with `credentials: "same-origin"`. No cookies are read or stored, no tokens are persisted, and no external HTTP is used (no `@connect`).
- **Quotas & Payments Never Bypassed** — a free-quota guard blocks any batch that would exceed a model's remaining free quota, and a paid-batch guard blocks batches whose cost is unknown or exceeds the ticket balance. Paid batches are only ever *prepared* for review and require explicit confirmation before submission.
- **No Modal UI** — the script augments the existing drawer and adds a non-blocking status pill. It never injects a modal, dialog, overlay, or portal that blocks reading.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/), [Violentmonkey](https://violentmonkey.github.io/), [ScriptCat](https://docs.scriptcat.org/en/), or [Stay](https://apps.apple.com/app/id1591620171).
2. Install the script from the [GitHub raw `.user.js`](https://raw.githubusercontent.com/MasuRii/wtr-lab-retranslate/main/dist/wtr-lab-retranslate.user.js) or download the latest artifact from the [`dist/` directory](https://github.com/MasuRii/wtr-lab-retranslate/tree/main/dist).
3. Navigate to any chapter page on `wtr-lab.com`.

> **Note:** This script is not yet listed on GreasyFork. Install directly from GitHub for now; a GreasyFork listing will be added once a script id is assigned.

## Usage

1. Navigate to a chapter page on `wtr-lab.com` (e.g. `wtr-lab.com/en/novel-*/*/*`).
2. Open the site's existing **Batch Re-Translate** drawer. Each model row is annotated inline with its candidate count, and the **Free Retranslate** section appears above the drawer footer.
3. Pick a **batch size** (e.g. *Next 3 chapters*) and optionally select one or more **models** to filter by.
4. The quota line shows how many of the matching chapters can be retranslated for free today. Click **Free Retranslate**, confirm the summary dialog, and watch progress in the drawer and the status pill.
5. To manually re-scan candidates, click the **userscript manager extension icon** and select **Re-scan Retranslate Candidates**.

### Target Pages

- `https://wtr-lab.com/en/novel/*/*/*`

### Permissions & APIs

The script uses only same-origin WTR-Lab endpoints (`/api/v2/chapter/retranslate/batch-info`, `/api/profile/usage`, `/api/v2/chapter/refresh-cost`, `/api/serie/refresh-request`, `/api/reader/task`, `/api/reader/get`) and the following userscript manager APIs:

| API | Purpose |
|-----|---------|
| `GM_getValue` / `GM_setValue` | Persist local preferences |
| `GM_registerMenuCommand` | Add the Re-scan Retranslate Candidates menu entry |

No cookie access, no cross-origin requests, and no `@connect` grants are used.

## Building from Source

**Requirements:** Node.js 20+, npm 10+

```bash
git clone https://github.com/MasuRii/wtr-lab-retranslate.git
cd wtr-lab-retranslate
npm ci
npm run validate
```

### Validation Commands

```bash
npm run typecheck        # Type-check TypeScript without emitting
npm run lint             # Run ESLint against src and test
npm run test             # Run the Jest test suite
npm run build            # Generate all userscript artifacts under dist/
npm run validate:userscript  # Validate dist/ artifacts, metadata headers, and URLs
npm run validate         # Standard local gate: typecheck, lint, test, build, then validate:userscript
```

### Build Variations

Webpack produces three userscript bundles from the same TypeScript source. Build configuration and version tooling use repo-local CommonJS files (`webpack.config.cjs`, `userscript.metadata.cjs`, and `config/versions.cjs`) to match the shared userscript convention. Do not hand-edit generated artifacts; change `src/**/*.ts` or related source files and rebuild.

| Script | Command | Output | Notes |
|--------|---------|--------|-------|
| Performance | `npm run build:performance` | `dist/wtr-lab-retranslate.user.js` | Minified production build with `downloadURL`/`updateURL` for auto-update from GitHub. |
| GreasyFork | `npm run build:greasyfork` | `dist/wtr-lab-retranslate.greasyfork.user.js` | Unminified build with no `downloadURL`/`updateURL` for GreasyFork compliance. |
| Development | `npm run build:devbundle` | `dist/wtr-lab-retranslate.dev.user.js` | `[DEV]`-named build with a dev version stamp and a localhost proxy script. |

Run `npm run dev` to serve the development build with hot reload at `http://localhost:8080`.

### Project Structure

```
wtr-lab-retranslate/
├── src/
│   ├── index.ts                    # Entry point: drawer observation, free-retranslate UI, menu command
│   ├── retranslate/
│   │   ├── api.ts                  # Same-origin fetch clients + pure parsers
│   │   ├── candidates.ts           # Candidate grouping by AI model
│   │   ├── domIntegration.ts       # Drawer badges, free-retranslate UI, status pill
│   │   ├── quotas.ts               # Free-quota and paid-batch safety guards
│   │   ├── retranslate.ts          # Guarded orchestration + free batch execution
│   │   └── types.ts                # Shared domain types
│   └── types/
│       └── userscript.d.ts         # Userscript manager API declarations
├── config/
│   └── versions.cjs                # Build-time version metadata
├── dist/                           # Installable userscript and metadata artifacts
├── test/                           # Jest test suite
├── userscript.metadata.cjs         # Canonical userscript metadata source
├── webpack.config.cjs              # Multi-build configuration
├── eslint.config.cjs               # ESLint configuration
├── tsconfig.json                   # TypeScript configuration
└── package.json                    # Project metadata
```

## Support

- [GitHub Issues](https://github.com/MasuRii/wtr-lab-retranslate/issues)
- [GitHub Discussions](https://github.com/MasuRii/wtr-lab-retranslate/discussions)

## License

MIT. See [LICENSE](LICENSE).
