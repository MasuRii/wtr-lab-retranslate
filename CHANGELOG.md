# Changelog

All notable changes to WTR Lab Retranslate will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---
## [Unreleased]

---
## [0.1.0] - 2026-07-03

### Added
- Free Batch Retranslate button injected into the existing WTR Lab Batch Re-Translate drawer, showing the remaining free daily retranslate quota and a one-click batch button.
- Batch-size and model filtering: reads the drawer's selected batch size and selected model rows, then retranslates only the matching chapters.
- Free-quota-only execution: triggers a free retranslate (`refresh-request`) per chapter and polls the real server-assigned task (`reader/task` via `reader/get`) until completion, with a bounded fallback status check when a Turnstile challenge blocks `reader/get`.
- Confirmation-first flow: a native confirm dialog summarizes the batch, model filter, matching chapter count, and free quota before anything is submitted.
- Live progress: an in-drawer per-chapter progress list plus a non-blocking status pill pinned to the screen that survives drawer close and client-side navigation.
- Per-model candidate-count badges annotating each existing `.brt-model-row`, with accessible `aria-label` descriptions.
- Debounced `MutationObserver` that keeps drawer annotations and the free-retranslate button state in sync as the selection changes.
- Safety guardrails: free-quota and paid-batch guards that never bypass quotas or payments, same-origin fetch only (`credentials: "same-origin"`), no cookie reading or storage, and no `@connect` grants.
- Multi-build webpack configuration producing Performance, GreasyFork, and Development userscript bundles from `config/versions.cjs` and `userscript.metadata.cjs`.
- Jest test suite covering the candidate grouping, quota/payment guards, same-origin API parsers, and DOM integration.

### Changed
- Rebranded the script and package from "WTR Lab Retranslate Assistant" to "WTR Lab Retranslate", removing the "Assistant" suffix across the name, package, repository URLs, dist artifact filenames, source, and documentation.
