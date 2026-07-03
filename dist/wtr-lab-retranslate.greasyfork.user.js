// ==UserScript==
// @name WTR Lab Retranslate
// @description Adds a Free Batch Retranslate button to the WTR-Lab Batch Re-Translate drawer, letting users batch-retranslate chapters filtered by model using the free daily quota — no tickets, no payment bypass, same-origin fetch only.
// @version 0.1.0
// @author MasuRii
// @supportURL https://github.com/MasuRii/wtr-lab-retranslate/issues
// @match https://wtr-lab.com/en/novel/*/*/*
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_registerMenuCommand
// @icon https://www.google.com/s2/favicons?sz=64&domain=wtr-lab.com
// @license MIT
// @namespace https://github.com/MasuRii/wtr-lab-retranslate
// @run-at document-idle
// @website https://github.com/MasuRii/wtr-lab-retranslate
// ==/UserScript==

/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

;// ./src/retranslate/candidates.ts
/**
 * Groups retranslate candidates by their `ai_id` (the AI model that produced the
 * current translation), preserving insertion order within each group.
 *
 * The input array is never mutated: a fresh `Map` of fresh arrays is returned,
 * so callers can safely pass a frozen/read-only candidate list.
 */
function groupCandidatesByAiId(candidates) {
    const grouped = new Map();
    for (const candidate of candidates) {
        let bucket = grouped.get(candidate.ai_id);
        if (bucket === undefined) {
            bucket = [];
            grouped.set(candidate.ai_id, bucket);
        }
        bucket.push(candidate);
    }
    return grouped;
}

;// ./src/retranslate/domIntegration.ts
// ---------------------------------------------------------------------------
// Inline badge annotation (existing — unchanged)
// ---------------------------------------------------------------------------
/**
 * Integrates retranslate candidate information into the EXISTING WTR-Lab Batch
 * Re-Translate drawer DOM (the `.brt-model-list` / `.brt-model-row` selectors
 * documented in `DomSelectors.md`).
 *
 * Each existing model row is annotated with a `.brt-candidate-count` badge
 * showing how many retranslate candidates exist for that model. This MUST NEVER
 * create its own modal, dialog, or overlay element — it only augments selector
 * elements already present in the page. The annotation is idempotent: re-running
 * removes any previous badge before adding a fresh one.
 */
function integrateRetranslateIntoDom(input) {
    const { modelList, candidatesByAiId } = input;
    const rows = Array.from(modelList.querySelectorAll(".brt-model-row"));
    let annotatedRowCount = 0;
    for (const row of rows) {
        const nameEl = row.querySelector(".brt-model-name");
        const modelName = nameEl?.textContent?.trim() ?? "";
        if (modelName === "") {
            continue;
        }
        const candidates = candidatesByAiId.get(modelName);
        if (candidates === undefined) {
            continue;
        }
        const count = candidates.length;
        row.querySelector(".brt-candidate-count")?.remove();
        const badge = document.createElement("span");
        badge.className = "brt-candidate-count";
        badge.setAttribute("aria-label", `${count} retranslate candidate${count === 1 ? "" : "s"} for ${modelName}`);
        badge.textContent = `${count} candidate${count === 1 ? "" : "s"}`;
        row.appendChild(badge);
        annotatedRowCount += 1;
    }
    return {
        annotatedRowCount,
        createdDialogCount: 0,
        createdOverlayCount: 0,
    };
}
// ---------------------------------------------------------------------------
// Free-retranslate UI injection
// ---------------------------------------------------------------------------
/** Unique class prefix to avoid collisions with WTR-Lab's own CSS. */
const FREE_SECTION_CLASS = "wtr-free-rt-section";
const FREE_BTN_CLASS = "wtr-free-rt-btn";
const FREE_QUOTA_CLASS = "wtr-free-rt-quota";
const FREE_PROGRESS_CLASS = "wtr-free-rt-progress";
/**
 * Injects the CSS styles for the free-retranslate UI. Called once at startup.
 * Uses the site's CSS custom properties (with fallbacks) so it adapts to dark
 * mode automatically.
 */
function injectFreeRetranslateStyles() {
    if (document.getElementById("wtr-free-rt-styles") !== null) {
        return;
    }
    const style = document.createElement("style");
    style.id = "wtr-free-rt-styles";
    style.textContent = `
.${FREE_SECTION_CLASS} {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  margin: 4px 0;
  border-radius: 10px;
  background: color-mix(in srgb, #22c55e 8%, var(--popover, #fff));
  border: 1px solid color-mix(in srgb, #22c55e 25%, var(--border, #e5e7eb));
}
.${FREE_QUOTA_CLASS} {
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted-foreground, #6b7280);
}
.${FREE_QUOTA_CLASS} strong { color: #22c55e; }
.${FREE_BTN_CLASS} {
  width: 100%;
  padding: 9px 16px;
  border: none;
  border-radius: 8px;
  background: #22c55e;
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: background .15s ease, opacity .15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.${FREE_BTN_CLASS}:hover:not(:disabled) { background: #16a34a; }
.${FREE_BTN_CLASS}:disabled { opacity: .5; cursor: not-allowed; }
.${FREE_PROGRESS_CLASS} {
  font-size: 13px;
  line-height: 1.5;
  max-height: 200px;
  overflow-y: auto;
}
.wtr-free-rt-item {
  padding: 3px 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.wtr-free-rt-ok { color: #22c55e; }
.wtr-free-rt-err { color: #ef4444; }
.wtr-free-rt-active { color: var(--foreground, #111); font-weight: 600; }
.wtr-free-rt-skip { color: var(--muted-foreground, #9ca3af); }
.wtr-free-rt-pill {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, #22c55e 12%, var(--popover, #fff));
  border: 1px solid color-mix(in srgb, #22c55e 30%, var(--border, #e5e7eb));
  box-shadow: 0 4px 16px rgba(0,0,0,.18);
  font-size: 12px;
  line-height: 1.3;
  color: var(--foreground, #111);
  max-width: 320px;
  cursor: default;
  user-select: none;
}
.wtr-free-rt-pill.wtr-free-rt-done { cursor: pointer; }
.wtr-free-rt-pill-spin { display: inline-block; animation: wtr-free-rt-spin 1s linear infinite; }
@keyframes wtr-free-rt-spin { to { transform: rotate(360deg); } }
.wtr-free-rt-pill-ok { color: #22c55e; font-weight: 600; }
.wtr-free-rt-pill-err { color: #ef4444; font-weight: 600; }
`;
    document.head.appendChild(style);
}
/**
 * Reads the selected batch-size option from the drawer and returns its key
 * (e.g. `"next_3"`, `"next_5"`). Falls back to `null` when nothing is selected.
 *
 * The drawer renders `.buc-option` elements with labels like "Next 3 chapters".
 * We extract the chapter count and build the key as `next_${count}` to match
 * the batch-info response's `options[].key` field.
 */
function readSelectedBatchOptionKey(drawer) {
    const selected = drawer.querySelector(".buc-option.is-selected");
    if (selected === null) {
        return null;
    }
    const label = selected.querySelector(".buc-option-label")?.textContent ??
        selected.textContent ??
        "";
    const match = label.match(/(\d+)/);
    if (match === null) {
        return null;
    }
    return `next_${match[1]}`;
}
/**
 * Reads the model names from the drawer's selected model rows
 * (`.brt-model-row.is-selected`). Returns an empty array when no models are
 * selected, which the caller may interpret as "all models".
 */
function readSelectedModelNames(drawer) {
    const rows = Array.from(drawer.querySelectorAll(".brt-model-row.is-selected"));
    const names = [];
    for (const row of rows) {
        const name = row.querySelector(".brt-model-name")?.textContent?.trim();
        if (name !== undefined && name !== "") {
            names.push(name);
        }
    }
    return names;
}
/**
 * Injects the free-retranslate UI section into the drawer, just before the
 * footer. If a previous section already exists (same class), it is removed
 * first to keep the injection idempotent.
 *
 * The UI consists of:
 *  - a quota-info line (updated externally via {@link updateQuotaInfo})
 *  - a "Free Retranslate" button (green, full-width)
 *  - a hidden progress container (shown during execution)
 */
function injectFreeRetranslateUI(drawer, options) {
    injectFreeRetranslateStyles();
    // Remove any previous injection (idempotent).
    drawer.querySelector(`.${FREE_SECTION_CLASS}`)?.remove();
    const section = document.createElement("div");
    section.className = FREE_SECTION_CLASS;
    const quotaInfo = document.createElement("div");
    quotaInfo.className = FREE_QUOTA_CLASS;
    quotaInfo.textContent = "Loading free retranslate quota…";
    const button = document.createElement("button");
    button.className = FREE_BTN_CLASS;
    button.type = "button";
    button.textContent = "Free Retranslate";
    button.disabled = true;
    button.addEventListener("click", () => {
        if (!button.disabled) {
            options.onClick();
        }
    });
    const progress = document.createElement("div");
    progress.className = FREE_PROGRESS_CLASS;
    progress.style.display = "none";
    section.appendChild(quotaInfo);
    section.appendChild(button);
    section.appendChild(progress);
    // Insert before the footer so it appears in the scrollable content area.
    const footer = drawer.querySelector('[data-slot="drawer-footer"]');
    if (footer !== null && footer.parentNode !== null) {
        footer.parentNode.insertBefore(section, footer);
    }
    else {
        drawer.appendChild(section);
    }
    return { section, button, quotaInfo, progress };
}
/**
 * Updates the quota-info line and button label.
 *
 * @param elements   - The elements returned by {@link injectFreeRetranslateUI}.
 * @param remaining  - Remaining free daily retranslates.
 * @param limit      - Total daily free retranslate limit.
 * @param selectedCount - Number of chapters currently selected for free retranslate.
 */
function updateQuotaInfo(elements, remaining, limit, selectedCount) {
    elements.quotaInfo.innerHTML = "";
    const text = document.createTextNode("Free retranslates today: ");
    const strong = document.createElement("strong");
    strong.textContent = `${remaining}`;
    const rest = document.createTextNode(`/${limit} remaining`);
    elements.quotaInfo.appendChild(text);
    elements.quotaInfo.appendChild(strong);
    elements.quotaInfo.appendChild(rest);
    if (selectedCount > 0) {
        const note = document.createElement("div");
        note.textContent = `${selectedCount} chapter${selectedCount === 1 ? "" : "s"} match the selected models — ${Math.min(selectedCount, remaining)} can be retranslated for free.`;
        elements.quotaInfo.appendChild(note);
    }
    elements.button.disabled = selectedCount === 0 || remaining === 0;
    elements.button.textContent =
        selectedCount > 0
            ? `Free Retranslate (${Math.min(selectedCount, remaining)} of ${selectedCount} chapters)`
            : "Free Retranslate";
}
/**
 * Shows the progress container and renders a progress update.
 *
 * @param elements - The elements returned by {@link injectFreeRetranslateUI}.
 * @param progress - The latest progress update.
 */
function updateFreeRetranslateProgress(elements, progress) {
    elements.progress.style.display = "block";
    elements.button.disabled = true;
    // Build or update the overall summary line.
    let summary = elements.progress.querySelector(".wtr-free-rt-summary");
    if (summary === null) {
        summary = document.createElement("div");
        summary.className = "wtr-free-rt-summary";
        summary.style.fontWeight = "600";
        summary.style.marginBottom = "4px";
        elements.progress.appendChild(summary);
    }
    summary.textContent = `Progress: ${progress.current} / ${progress.total}`;
    // Find or create the item line for this chapter.
    const itemId = `wtr-free-rt-ch-${progress.chapterId}`;
    let item = elements.progress.querySelector(`#${itemId}`);
    if (item === null) {
        item = document.createElement("div");
        item.id = itemId;
        item.className = "wtr-free-rt-item";
        elements.progress.appendChild(item);
    }
    const icon = progress.state === "completed"
        ? "✓"
        : progress.state === "failed"
            ? "✗"
            : progress.state === "skipped"
                ? "⊘"
                : "⟳";
    const cls = progress.state === "completed"
        ? "wtr-free-rt-ok"
        : progress.state === "failed"
            ? "wtr-free-rt-err"
            : progress.state === "skipped"
                ? "wtr-free-rt-skip"
                : "wtr-free-rt-active";
    item.className = `wtr-free-rt-item ${cls}`;
    item.textContent = `${icon} Ch. ${progress.chapterOrder} — ${progress.modelName}${progress.message !== undefined ? ` (${progress.message})` : ""}`;
}
/**
 * Resets the progress container (hides it and clears all items).
 */
function resetFreeRetranslateProgress(elements) {
    elements.progress.style.display = "none";
    elements.progress.innerHTML = "";
}
// ---------------------------------------------------------------------------
// Persistent background status pill (survives drawer close / SPA navigation)
// ---------------------------------------------------------------------------
const STATUS_PILL_ID = "wtr-free-rt-status-pill";
let pillHideTimer = null;
/**
 * Returns the persistent status pill, creating it (appended to <body>) if it
 * does not exist. Because it lives on <body> rather than inside the
 * React-managed drawer, it survives drawer close/reopen and client-side
 * navigation, so background retranslate progress stays visible while reading.
 * Never a modal/overlay — just a small, non-blocking status indicator.
 */
function ensureStatusPill() {
    injectFreeRetranslateStyles();
    let pill = document.getElementById(STATUS_PILL_ID);
    if (pill === null) {
        pill = document.createElement("div");
        pill.id = STATUS_PILL_ID;
        pill.className = "wtr-free-rt-pill";
        pill.textContent = "Retranslating…";
        document.body.appendChild(pill);
    }
    if (pillHideTimer !== null) {
        clearTimeout(pillHideTimer);
        pillHideTimer = null;
    }
    pill.style.display = "flex";
    pill.classList.remove("wtr-free-rt-done");
    pill.onclick = null;
    return pill;
}
/**
 * Updates the pill with the latest batch progress. A status indicator only — it
 * never blocks reading and never creates a modal/overlay.
 */
function updateStatusPill(state) {
    const pill = ensureStatusPill();
    const pct = state.total > 0 ? Math.round((state.current / state.total) * 100) : 0;
    pill.classList.remove("wtr-free-rt-done");
    pill.innerHTML = "";
    const spin = document.createElement("span");
    spin.className = "wtr-free-rt-pill-spin";
    spin.textContent = "⟳";
    pill.appendChild(spin);
    const txt = document.createElement("span");
    txt.textContent =
        `Retranslating ${state.current}/${state.total} (${pct}%) · ✓${state.completed} ✗${state.failed}` +
            (state.skipped > 0 ? ` ⊘${state.skipped}` : "");
    pill.appendChild(txt);
}
/**
 * Shows a completion summary on the pill and auto-hides it after a few seconds.
 * Clicking the pill dismisses it immediately. The batch already finished, so
 * dismissing only hides the indicator.
 */
function finishStatusPill(summary) {
    const pill = ensureStatusPill();
    pill.classList.add("wtr-free-rt-done");
    pill.innerHTML = "";
    const icon = document.createElement("span");
    icon.className = summary.failed > 0 ? "wtr-free-rt-pill-err" : "wtr-free-rt-pill-ok";
    icon.textContent = summary.failed > 0 ? "⚠" : "✓";
    pill.appendChild(icon);
    const txt = document.createElement("span");
    txt.textContent =
        `Done: ✓${summary.completed} ✗${summary.failed}` +
            (summary.skipped > 0 ? ` ⊘${summary.skipped}` : "") +
            ` · ${summary.remainingQuota} free left`;
    pill.appendChild(txt);
    pill.onclick = () => removeStatusPill();
    pillHideTimer = window.setTimeout(() => removeStatusPill(), 12_000);
}
/** Removes the status pill (if present) and cancels any pending auto-hide. */
function removeStatusPill() {
    if (pillHideTimer !== null) {
        clearTimeout(pillHideTimer);
        pillHideTimer = null;
    }
    document.getElementById(STATUS_PILL_ID)?.remove();
}

;// ./src/retranslate/api.ts
// Same-origin API clients and pure parsers for the WTR-Lab retranslate flows.
//
// These helpers talk ONLY to same-origin WTR-Lab endpoints via `fetch`
// (credentials: "same-origin"). No cookies are read, no tokens are stored, and
// no external HTTP is used. The parsers are pure functions over plain data so
// they can be unit-tested in isolation; they are never invoked during
// `npm test` / `npm run validate`.
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function asString(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------
/**
 * Parses a same-origin `reader/get` payload into retranslate candidates.
 *
 * Pure and defensive: a non-object payload yields an empty list, and malformed
 * entries are skipped rather than thrown. `ai_id` is the model identifier that
 * produced a chapter's current translation.
 */
function parseReaderGetResponse(payload) {
    const candidates = [];
    if (typeof payload !== "object" || payload === null) {
        return candidates;
    }
    const root = payload;
    const chapters = root.data ?? payload;
    if (!Array.isArray(chapters)) {
        return candidates;
    }
    for (const entry of chapters) {
        if (typeof entry !== "object" || entry === null) {
            continue;
        }
        const record = entry;
        const chapterId = asNumber(record.id ?? record.chapter_id);
        const chapterNo = asNumber(record.chapter_no ?? record.chapterNo) ?? chapterId;
        const ai_id = asString(record.ai_id ?? record.model);
        if (chapterId === undefined || ai_id === undefined) {
            continue;
        }
        candidates.push({ chapterId, chapterNo, ai_id });
    }
    return candidates;
}
/**
 * Parses a same-origin `batch-info` payload into quota/cost/balance maps, model
 * list, and batch-size options with per-chapter details.
 *
 * The key for `freeQuotaByAiId` / `unitCostByAiId` prefers the model `name`
 * (when present) over the raw `ai_id`, so it matches the model-name keys used
 * by the drawer's `.brt-model-name` elements. For payloads without a `name`
 * field (e.g. test fixtures), the key falls back to the stringified `ai_id` /
 * `id`, preserving backward compatibility.
 *
 * Pure and defensive: a non-object payload yields zero balance, empty maps,
 * empty arrays, never a throw. Missing optional fields default to zero.
 */
function parseBatchInfoResponse(payload) {
    const freeQuotaByAiId = new Map();
    const unitCostByAiId = new Map();
    const models = [];
    const options = [];
    let ticketBalance = 0;
    let eligible = 0;
    let total = 0;
    if (typeof payload !== "object" || payload === null) {
        return { ticketBalance, freeQuotaByAiId, unitCostByAiId, models, options, eligible, total };
    }
    const record = payload;
    ticketBalance = asNumber(record.ticket_balance ?? record.balance) ?? 0;
    eligible = asNumber(record.eligible) ?? 0;
    total = asNumber(record.total) ?? 0;
    // --- models array -------------------------------------------------------
    const modelList = (record.models ?? record.model_list);
    if (Array.isArray(modelList)) {
        for (const model of modelList) {
            if (typeof model !== "object" || model === null) {
                continue;
            }
            const m = model;
            const aiId = asNumber(m.ai_id ?? m.id) ?? 0;
            const name = asString(m.name ?? m.ai_id ?? m.id) ?? String(m.ai_id ?? m.id ?? "");
            // Key prefers name (matches drawer) then falls back to ai_id/id.
            const key = asString(m.name) ?? asString(m.ai_id ?? m.id) ?? name;
            freeQuotaByAiId.set(key, asNumber(m.free_quota ?? m.quota) ?? 0);
            unitCostByAiId.set(key, asNumber(m.unit_cost ?? m.cost) ?? 0);
            models.push({
                aiId,
                name,
                count: asNumber(m.count) ?? 0,
                cost: asNumber(m.cost) ?? 0,
            });
        }
    }
    // --- options array (batch sizes with per-chapter details) ---------------
    const optionList = record.options;
    if (Array.isArray(optionList)) {
        for (const opt of optionList) {
            if (typeof opt !== "object" || opt === null) {
                continue;
            }
            const o = opt;
            const chapters = [];
            const chapterList = o.chapters;
            if (Array.isArray(chapterList)) {
                for (const ch of chapterList) {
                    if (typeof ch !== "object" || ch === null) {
                        continue;
                    }
                    const c = ch;
                    const id = asNumber(c.id) ?? 0;
                    const order = asNumber(c.order) ?? 0;
                    const aiId = asNumber(c.ai_id) ?? 0;
                    const cost = asNumber(c.cost) ?? 0;
                    if (id === 0) {
                        continue;
                    }
                    chapters.push({ id, order, aiId, cost });
                }
            }
            options.push({
                key: asString(o.key) ?? "",
                label: asString(o.label) ?? "",
                count: asNumber(o.count) ?? chapters.length,
                cost: asNumber(o.cost) ?? 0,
                firstOrder: asNumber(o.first_order) ?? 0,
                lastOrder: asNumber(o.last_order) ?? 0,
                chapters,
            });
        }
    }
    return { ticketBalance, freeQuotaByAiId, unitCostByAiId, models, options, eligible, total };
}
/**
 * Parses a `refresh-cost` response (GET /api/v2/chapter/refresh-cost).
 * Pure and defensive: non-object payloads yield zeroed defaults.
 */
function parseRefreshCostResponse(payload) {
    if (typeof payload !== "object" || payload === null) {
        return { hasQuota: false, cost: 0, remaining: 0 };
    }
    const record = payload;
    return {
        hasQuota: Boolean(record.has_quota),
        cost: asNumber(record.cost) ?? 0,
        remaining: asNumber(record.remaining) ?? 0,
    };
}
/**
 * Parses a `refresh-request` response (POST /api/serie/refresh-request).
 * Handles the observed typo `remeaining` as well as the correct `remaining`.
 * Pure and defensive: non-object payloads yield a failed result.
 */
function parseFreeRetranslateResponse(payload) {
    if (typeof payload !== "object" || payload === null) {
        return { success: false, remaining: 0, paidCost: 0 };
    }
    const record = payload;
    return {
        success: Boolean(record.success),
        remaining: asNumber(record.remeaining ?? record.remaining) ?? 0,
        paidCost: asNumber(record.paid_cost ?? record.paidCost) ?? 0,
    };
}
/**
 * Parses a `reader/task` response (POST /api/reader/task).
 * Pure and defensive: non-object payloads yield an expired/failed status.
 */
function parseTaskStatusResponse(payload) {
    if (typeof payload !== "object" || payload === null) {
        return { state: "failed", ratio: 0, isExpired: true };
    }
    const record = payload;
    const job = (record.job ?? record);
    return {
        state: asString(job.state) ?? "unknown",
        ratio: asNumber(job.ratio) ?? 0,
        isExpired: Boolean(job.isExpired ?? job.is_expired),
    };
}
/**
 * Parses a `profile/usage` response (GET /api/profile/usage).
 * Pure and defensive: non-object payloads yield zeroed usage.
 */
function parseUsageResponse(payload) {
    if (typeof payload !== "object" || payload === null) {
        return { dailyRetranslateLimit: 0, dailyRetranslateUsed: 0 };
    }
    const record = payload;
    const usage = (record.usage ?? record);
    const retranslate = (usage.daily_retranslate ?? usage.dailyRetranslate);
    return {
        dailyRetranslateLimit: asNumber(retranslate?.limit) ?? 0,
        dailyRetranslateUsed: asNumber(retranslate?.used) ?? 0,
    };
}
// ---------------------------------------------------------------------------
// Fetch wrappers (injectable fetchImpl for testability)
// ---------------------------------------------------------------------------
/**
 * Same-origin fetch wrapper for `reader/get`. Returns raw JSON (`unknown`) so the
 * caller can feed it to {@link parseReaderGetResponse}. The fetch implementation
 * is injectable for testability; the default is the page's same-origin `fetch`.
 */
async function fetchReaderGet(input, fetchImpl = fetch) {
    const params = new URLSearchParams();
    params.set("novel_id", String(input.novelId));
    for (const id of input.chapterIds) {
        params.append("chapter_ids[]", String(id));
    }
    const response = await fetchImpl(`/api/reader/get?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(`reader/get failed: ${response.status}`);
    }
    return response.json();
}
/**
 * Same-origin fetch wrapper for `batch-info`. Returns raw JSON (`unknown`) so the
 * caller can feed it to {@link parseBatchInfoResponse}. The fetch implementation
 * is injectable for testability; the default is the page's same-origin `fetch`.
 *
 * Uses the observed WTR-Lab versioned endpoint
 * `/api/v2/chapter/retranslate/batch-info` with `raw_id` (the novel's raw id)
 * and `start_order` (the chapter order to start from) query parameters.
 */
async function fetchBatchInfo(input, fetchImpl = fetch) {
    const params = new URLSearchParams();
    params.set("raw_id", String(input.rawId));
    params.set("start_order", String(input.startOrder));
    const response = await fetchImpl(`/api/v2/chapter/retranslate/batch-info?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(`batch-info failed: ${response.status}`);
    }
    return response.json();
}
/**
 * Same-origin fetch wrapper for `refresh-cost` (GET /api/v2/chapter/refresh-cost).
 * Checks whether a free retranslate quota is available for the given chapter.
 */
async function fetchRefreshCost(chapterId, fetchImpl = fetch) {
    const params = new URLSearchParams();
    params.set("chapter_id", String(chapterId));
    params.set("type", "translate");
    const response = await fetchImpl(`/api/v2/chapter/refresh-cost?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(`refresh-cost failed: ${response.status}`);
    }
    return response.json();
}
/**
 * Same-origin fetch wrapper for `refresh-request` (POST /api/serie/refresh-request).
 * Triggers a FREE chapter re-translation using the daily free quota.
 *
 * Uses the observed POST body shape:
 *   { raw_id, translate:"ai", language, chapter_id, refresh_translation:true }
 */
async function triggerFreeRetranslate(input, fetchImpl = fetch) {
    const body = JSON.stringify({
        raw_id: input.rawId,
        translate: "ai",
        language: input.language,
        chapter_id: input.chapterId,
        refresh_translation: true,
    });
    const response = await fetchImpl("/api/serie/refresh-request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body,
    });
    if (!response.ok) {
        throw new Error(`refresh-request failed: ${response.status}`);
    }
    return response.json();
}
/**
 * Same-origin fetch wrapper for `reader/task` (POST /api/reader/task).
 * Polls the translation/retranslation task status for a given chapter.
 *
 * Uses the observed POST body shape:
 *   { chapter_id, raw_id, language, translate:"ai", task_id, type:1 }
 */
async function pollRetranslateTask(input, fetchImpl = fetch) {
    const body = JSON.stringify({
        chapter_id: input.chapterId,
        raw_id: input.rawId,
        language: input.language,
        translate: "ai",
        task_id: input.taskId,
        type: 1,
    });
    const response = await fetchImpl("/api/reader/task", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body,
    });
    if (!response.ok) {
        throw new Error(`reader/task failed: ${response.status}`);
    }
    return response.json();
}
/**
 * Same-origin fetch wrapper for `profile/usage` (GET /api/profile/usage).
 * Returns the daily free retranslate quota and usage.
 */
async function fetchUsage(fetchImpl = fetch) {
    const response = await fetchImpl("/api/profile/usage", {
        method: "GET",
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(`profile/usage failed: ${response.status}`);
    }
    return response.json();
}
/**
 * Same-origin fetch wrapper for `reader/get` (POST) targeting a single chapter.
 * Returns the raw JSON, which includes a top-level `tasks` array (each entry has
 * a `task_id` for the chapter's active retranslate job) and `data.status`
 * (2 = translating, 4 = completed).
 *
 * This is used to obtain the REAL server-assigned `task_id` for polling
 * `reader/task` — a client-generated UUID is rejected with "Task not found".
 *
 * Observed POST body shape:
 *   { translate:"ai", language, raw_id, chapter_no, retry:false, force_retry:false, chapter_id }
 */
async function fetchChapterTask(input, fetchImpl = fetch) {
    const body = JSON.stringify({
        translate: "ai",
        language: input.language,
        raw_id: input.rawId,
        chapter_no: input.chapterNo,
        retry: false,
        force_retry: false,
        chapter_id: input.chapterId,
    });
    const response = await fetchImpl("/api/reader/get", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body,
    });
    if (!response.ok) {
        throw new Error(`reader/get failed: ${response.status}`);
    }
    return response.json();
}
/**
 * Extracts the active retranslate `task_id` for a chapter from a `reader/get`
 * payload. The payload's top-level `tasks` array holds one entry per active job
 * (with `chapter_id`, `type: 1` for translate, and `task_id`). Returns
 * `undefined` when no matching task is present (already completed, or the
 * payload is a Turnstile/error response). Pure and defensive.
 */
function parseChapterTaskId(payload, chapterId) {
    if (typeof payload !== "object" || payload === null) {
        return undefined;
    }
    const record = payload;
    const tasks = record.tasks;
    if (!Array.isArray(tasks)) {
        return undefined;
    }
    for (const task of tasks) {
        if (typeof task !== "object" || task === null) {
            continue;
        }
        const t = task;
        const cid = asNumber(t.chapter_id);
        const type = asNumber(t.type);
        if (cid === chapterId && (type === 1 || type === undefined)) {
            return asString(t.task_id);
        }
    }
    return undefined;
}
/**
 * Extracts `data.status` from a `reader/get` payload. Observed values:
 * 2 = translation in progress, 4 = completed. Returns `undefined` when absent
 * (e.g. Turnstile/error payload). Pure and defensive.
 */
function parseChapterStatus(payload) {
    if (typeof payload !== "object" || payload === null) {
        return undefined;
    }
    const record = payload;
    const data = record.data;
    if (typeof data !== "object" || data === null) {
        return undefined;
    }
    return asNumber(data.status);
}

;// ./src/retranslate/retranslate.ts
/* unused harmony import specifier */ var evaluateFreeQuotaGuard;
/* unused harmony import specifier */ var evaluatePaidBatchGuard;
// Orchestration helpers that compose the pure guards with caller-provided
// confirmation and mutation actions.
//
// Safety contract (preserves the user's guardrails):
//   - Free retranslate: the free-quota guard runs FIRST. If it blocks (no quota
//     or over quota), the helper stops immediately — no confirmation prompt and
//     no mutation. Only when allowed does it ask the caller to confirm, and only
//     then perform the injected mutation.
//   - Paid batch: the helper NEVER auto-submits. It prepares the affordability
//     decision and candidate summary, and only submits when the caller's
//     explicit confirmation callback resolves to true.
//   - Neither helper performs network I/O itself; all side effects (prompts and
//     submissions) are injected by the caller, keeping these helpers testable
//     and free of live WTR-Lab calls during validation.


/**
 * Runs the free-quota guard, then — only if allowed — asks the caller to confirm
 * before performing the mutation. Stops with `executed: false` when the guard
 * blocks (no/over quota) or the caller declines. Never bypasses the free quota.
 */
async function prepareFreeRetranslate(input, confirm, mutate) {
    const decision = evaluateFreeQuotaGuard(input);
    if (!decision.allowed) {
        return { decision, executed: false };
    }
    const confirmed = await confirm();
    if (!confirmed) {
        return { decision, executed: false };
    }
    await mutate();
    return { decision, executed: true };
}
/**
 * Prepares a paid batch for review: computes the affordability decision and
 * candidate groups WITHOUT submitting. Submission only happens via
 * {@link submitPaidBatch} after explicit caller confirmation.
 */
function preparePaidBatch(input) {
    return {
        decision: evaluatePaidBatchGuard(input),
        candidatesByAiId: input.candidatesByAiId,
    };
}
/**
 * Submits a prepared paid batch only when the caller explicitly confirms. Never
 * auto-submits: if the guard blocked or `confirm` resolves false, nothing is
 * submitted. Payment is never bypassed.
 */
async function submitPaidBatch(prepared, confirm, submit) {
    if (!prepared.decision.allowed) {
        return { decision: prepared.decision, executed: false };
    }
    const confirmed = await confirm();
    if (!confirmed) {
        return { decision: prepared.decision, executed: false };
    }
    await submit();
    return { decision: prepared.decision, executed: true };
}
/** Default poll interval (2 seconds, matching the site's own polling cadence). */
const DEFAULT_POLL_INTERVAL_MS = 2000;
/** Default poll timeout (3 minutes per chapter). */
const DEFAULT_POLL_TIMEOUT_MS = 180_000;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Executes a free batch retranslate: for each chapter (up to the remaining free
 * daily quota), triggers a free retranslation via `refresh-request` and polls
 * `reader/task` until the chapter is completed.
 *
 * Stops early when the free quota is exhausted (the server reports
 * `remaining: 0` or `success: false`). Progress is reported via the
 * `onProgress` callback after each state transition.
 *
 * All network calls use same-origin `fetch` with `credentials: "same-origin"`.
 * No cookies are read or stored; no payment is ever bypassed.
 */
async function executeFreeBatchRetranslate(input, onProgress) {
    const { chapters, rawId, language, modelNameByAiId, fetchImpl = fetch, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS, } = input;
    const total = chapters.length;
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    let remainingQuota = 0;
    // Check the initial free quota via refresh-cost on the first chapter.
    if (total > 0) {
        try {
            const costPayload = await fetchRefreshCost(chapters[0].id, fetchImpl);
            const costInfo = parseRefreshCostResponse(costPayload);
            remainingQuota = costInfo.remaining;
            if (!costInfo.hasQuota || remainingQuota <= 0) {
                for (let i = 0; i < total; i += 1) {
                    const ch = chapters[i];
                    onProgress({
                        current: i + 1,
                        total,
                        chapterId: ch.id,
                        chapterOrder: ch.order,
                        modelName: modelNameByAiId.get(ch.aiId) ?? `ai-${ch.aiId}`,
                        state: "skipped",
                        message: "No free quota remaining",
                        remainingQuota: 0,
                    });
                    skipped += 1;
                }
                return { completed, failed, skipped, remainingQuota: 0 };
            }
        }
        catch {
            // refresh-cost failed — proceed anyway; refresh-request will enforce.
        }
    }
    for (let i = 0; i < total; i += 1) {
        const ch = chapters[i];
        const modelName = modelNameByAiId.get(ch.aiId) ?? `ai-${ch.aiId}`;
        const current = i + 1;
        // Stop if free quota is exhausted.
        if (remainingQuota <= 0) {
            onProgress({
                current,
                total,
                chapterId: ch.id,
                chapterOrder: ch.order,
                modelName,
                state: "skipped",
                message: "Free quota exhausted",
                remainingQuota: 0,
            });
            skipped += 1;
            continue;
        }
        // Notify: starting this chapter.
        onProgress({
            current,
            total,
            chapterId: ch.id,
            chapterOrder: ch.order,
            modelName,
            state: "translating",
            message: "Requesting free retranslate…",
            remainingQuota,
        });
        try {
            // Trigger the free retranslation.
            const refreshPayload = await triggerFreeRetranslate({ rawId, chapterId: ch.id, language }, fetchImpl);
            const refreshResult = parseFreeRetranslateResponse(refreshPayload);
            if (!refreshResult.success) {
                onProgress({
                    current,
                    total,
                    chapterId: ch.id,
                    chapterOrder: ch.order,
                    modelName,
                    state: "failed",
                    message: "Server rejected free retranslate",
                    remainingQuota: refreshResult.remaining,
                });
                failed += 1;
                remainingQuota = refreshResult.remaining;
                continue;
            }
            remainingQuota = refreshResult.remaining;
            // Obtain the REAL server-assigned task_id from reader/get. A
            // client-generated UUID is rejected with "Task not found", so the
            // task_id the server registered for this chapter must be read back.
            // Retry briefly to handle the race where the task is not yet listed.
            let taskId;
            let taskDone = false;
            for (let attempt = 0; attempt < 3 && taskId === undefined && !taskDone; attempt += 1) {
                if (attempt > 0) {
                    await sleep(pollIntervalMs);
                }
                try {
                    const chapterPayload = await fetchChapterTask({ rawId, chapterId: ch.id, chapterNo: ch.order, language }, fetchImpl);
                    taskId = parseChapterTaskId(chapterPayload, ch.id);
                    if (taskId === undefined &&
                        parseChapterStatus(chapterPayload) === 4) {
                        // Translation already finished before we could poll.
                        taskDone = true;
                    }
                }
                catch {
                    // reader/get failed (possibly a Turnstile challenge); retry.
                }
            }
            // Poll reader/task with the real task_id until completed or timeout.
            if (!taskDone && taskId !== undefined) {
                const startTime = Date.now();
                while (Date.now() - startTime < pollTimeoutMs) {
                    await sleep(pollIntervalMs);
                    try {
                        const taskPayload = await pollRetranslateTask({ chapterId: ch.id, rawId, language, taskId }, fetchImpl);
                        const status = parseTaskStatusResponse(taskPayload);
                        if (status.state === "completed") {
                            taskDone = true;
                            break;
                        }
                        if (status.isExpired || status.state === "failed") {
                            break;
                        }
                        // Still active — keep polling.
                        onProgress({
                            current,
                            total,
                            chapterId: ch.id,
                            chapterOrder: ch.order,
                            modelName,
                            state: "translating",
                            message: `Translating… ${status.ratio}%`,
                            remainingQuota,
                        });
                    }
                    catch {
                        // Transient poll error — keep trying until timeout.
                    }
                }
            }
            else if (!taskDone) {
                // No task_id available (e.g. Turnstile blocked reader/get): poll
                // reader/get's data.status as a bounded fallback so completion is still
                // detected. Give up quickly if reader/get keeps returning non-data
                // (Turnstile/error) responses instead of wasting time.
                const startTime = Date.now();
                const fallbackTimeoutMs = Math.min(pollTimeoutMs, 90_000);
                let consecutiveErrors = 0;
                while (Date.now() - startTime < fallbackTimeoutMs) {
                    await sleep(pollIntervalMs * 2);
                    try {
                        const chapterPayload = await fetchChapterTask({ rawId, chapterId: ch.id, chapterNo: ch.order, language }, fetchImpl);
                        const status = parseChapterStatus(chapterPayload);
                        if (status === 4) {
                            taskDone = true;
                            break;
                        }
                        if (status === undefined) {
                            consecutiveErrors += 1;
                            if (consecutiveErrors >= 3) {
                                break; // reader/get is not returning chapter data; stop.
                            }
                        }
                        else {
                            consecutiveErrors = 0;
                            onProgress({
                                current,
                                total,
                                chapterId: ch.id,
                                chapterOrder: ch.order,
                                modelName,
                                state: "translating",
                                message: "Translating… (status check)",
                                remainingQuota,
                            });
                        }
                    }
                    catch {
                        consecutiveErrors += 1;
                        if (consecutiveErrors >= 3) {
                            break;
                        }
                    }
                }
            }
            if (taskDone) {
                onProgress({
                    current,
                    total,
                    chapterId: ch.id,
                    chapterOrder: ch.order,
                    modelName,
                    state: "completed",
                    remainingQuota,
                });
                completed += 1;
            }
            else {
                onProgress({
                    current,
                    total,
                    chapterId: ch.id,
                    chapterOrder: ch.order,
                    modelName,
                    state: "failed",
                    message: "Translation timed out",
                    remainingQuota,
                });
                failed += 1;
            }
        }
        catch {
            onProgress({
                current,
                total,
                chapterId: ch.id,
                chapterOrder: ch.order,
                modelName,
                state: "failed",
                message: "Network error",
                remainingQuota,
            });
            failed += 1;
        }
    }
    return { completed, failed, skipped, remainingQuota };
}

;// ./src/index.ts
// WTR Lab Retranslate — webpack entry point.
//
// Detects chapter/model retranslate candidates on WTR-Lab and integrates them
// into the EXISTING Batch Re-Translate drawer DOM. It adds a separate "Free
// Retranslate" button that uses the daily free retranslate quota (never costing
// tickets), lets the user select chapters by batch size and filter by model,
// and batch-retranslates matching chapters sequentially with live progress.
//
// Safety: never bypasses quotas or payments, never reads/stores cookies, uses
// same-origin fetch only, and never creates its own modal/dialog/overlay UI.




const MODEL_LIST_SELECTOR = ".brt-model-list";
const DRAWER_SELECTOR = ".batch-unlock-canvas";
// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------
/** Parses the novel raw id from the same-origin URL path (`/en/novel/<id>/...`). */
function parseRawId() {
    const match = window.location.pathname.match(/novel\/(\d+)/);
    if (match === null) {
        return null;
    }
    const id = Number.parseInt(match[1], 10);
    return Number.isFinite(id) ? id : null;
}
/**
 * Parses the chapter start order from the same-origin URL path. The chapter
 * order is the numeric segment of the `chapter-<n>` path component (e.g.
 * `/en/novel/42/slug/chapter-100` → `100`). Returns `null` when absent.
 */
function parseStartOrder() {
    const match = window.location.pathname.match(/chapter-(\d+)/);
    if (match === null) {
        return null;
    }
    const order = Number.parseInt(match[1], 10);
    return Number.isFinite(order) ? order : null;
}
/** Parses the language code from the URL path (e.g. `/en/novel/…` → `"en"`). */
function parseLanguage() {
    const match = window.location.pathname.match(/^\/(\w+)\//);
    return match !== null ? match[1] : "en";
}
// ---------------------------------------------------------------------------
// Drawer annotation (existing — badge counts)
// ---------------------------------------------------------------------------
const MODEL_ROW_SELECTOR = ".brt-model-row";
const MODEL_NAME_SELECTOR = ".brt-model-name";
const MODEL_COUNT_SELECTOR = ".brt-model-count";
/**
 * Derives a flat candidate list from the drawer's existing model rows. Each row
 * already states the model name and a chapter count (e.g. "2 ch."), which is
 * turned into candidate entries for annotation. Synchronous: no network, no
 * modal.
 */
function collectCandidatesFromDrawer(modelList) {
    const candidates = [];
    const rows = Array.from(modelList.querySelectorAll(MODEL_ROW_SELECTOR));
    for (const row of rows) {
        const name = row.querySelector(MODEL_NAME_SELECTOR)?.textContent?.trim() ?? "";
        if (name === "") {
            continue;
        }
        const countText = row.querySelector(MODEL_COUNT_SELECTOR)?.textContent ?? "";
        const count = Number.parseInt(countText, 10) || 0;
        for (let i = 0; i < count; i += 1) {
            candidates.push({ chapterId: i, chapterNo: i, ai_id: name });
        }
    }
    return candidates;
}
/**
 * Annotates the existing Batch Re-Translate drawer with per-model candidate
 * counts. Never creates a modal/dialog/overlay — it only augments the existing
 * `.brt-model-row` elements already rendered by the site.
 */
function annotateDrawer(modelList) {
    const candidatesByAiId = groupCandidatesByAiId(collectCandidatesFromDrawer(modelList));
    integrateRetranslateIntoDom({ modelList, candidatesByAiId });
}
// ---------------------------------------------------------------------------
// Cached batch-info and usage
// ---------------------------------------------------------------------------
let cachedBatchInfo = null;
let cachedBatchInfoKey = "";
let cachedUsage = null;
let cachedUsageTime = 0;
let freeRetranslateUI = null;
let isRetranslating = false;
const USAGE_CACHE_TTL_MS = 30_000;
/** Fetches and caches batch-info for the current novel/chapter. */
async function ensureBatchInfo() {
    const rawId = parseRawId();
    const startOrder = parseStartOrder();
    if (rawId === null || startOrder === null) {
        return null;
    }
    const key = `${rawId}:${startOrder}`;
    if (cachedBatchInfo !== null && cachedBatchInfoKey === key) {
        return cachedBatchInfo;
    }
    try {
        const payload = await fetchBatchInfo({ rawId, startOrder });
        cachedBatchInfo = parseBatchInfoResponse(payload);
        cachedBatchInfoKey = key;
        return cachedBatchInfo;
    }
    catch {
        return null;
    }
}
/** Fetches and caches usage (free retranslate quota) with a short TTL. */
async function ensureUsage(force = false) {
    const now = Date.now();
    if (!force &&
        cachedUsage !== null &&
        now - cachedUsageTime < USAGE_CACHE_TTL_MS) {
        return cachedUsage;
    }
    try {
        const payload = await fetchUsage();
        cachedUsage = parseUsageResponse(payload);
        cachedUsageTime = now;
        return cachedUsage;
    }
    catch {
        return null;
    }
}
/**
 * Builds a map from numeric aiId → model name using the batch-info models array.
 */
function buildModelNameByAiId(batchInfo) {
    const map = new Map();
    for (const model of batchInfo.models) {
        map.set(model.aiId, model.name);
    }
    return map;
}
/**
 * Filters chapters from the selected batch option by the selected model names.
 * If no models are selected, all chapters in the option are returned.
 */
function filterChaptersByModels(batchInfo, optionKey, selectedModelNames) {
    const option = batchInfo.options.find((o) => o.key === optionKey);
    if (option === undefined) {
        return [];
    }
    if (selectedModelNames.length === 0) {
        return [...option.chapters];
    }
    // Build a set of selected aiIds by matching model names.
    const nameToAiId = new Map();
    for (const model of batchInfo.models) {
        nameToAiId.set(model.name, model.aiId);
    }
    const selectedAiIds = new Set();
    for (const name of selectedModelNames) {
        const aiId = nameToAiId.get(name);
        if (aiId !== undefined) {
            selectedAiIds.add(aiId);
        }
    }
    return option.chapters.filter((ch) => selectedAiIds.has(ch.aiId));
}
/**
 * Computes how many chapters in the currently-selected batch option match the
 * currently-selected models. Returns 0 when no batch option is selected. Used to
 * keep the "Free Retranslate" button enabled/disabled and labelled correctly.
 */
function computeSelectedChapterCount(drawer, batchInfo) {
    const optionKey = readSelectedBatchOptionKey(drawer);
    if (optionKey === null) {
        return 0;
    }
    const selectedModelNames = readSelectedModelNames(drawer);
    return filterChaptersByModels(batchInfo, optionKey, selectedModelNames).length;
}
/** Last (selectedCount, remaining) pushed to updateQuotaInfo, to skip no-op updates. */
let lastRefreshSelectedCount = -1;
let lastRefreshRemaining = -1;
/**
 * Refreshes the free-retranslate button state from the cached batch-info/usage
 * and the drawer's current selection. Only writes to the DOM when the computed
 * (selectedCount, remaining) actually changed, so it is safe to call on every
 * (debounced) drawer mutation.
 */
function refreshFreeRetranslateButton(drawer) {
    if (freeRetranslateUI === null || isRetranslating) {
        return;
    }
    if (cachedBatchInfo === null || cachedUsage === null) {
        return;
    }
    const remaining = cachedUsage.dailyRetranslateLimit - cachedUsage.dailyRetranslateUsed;
    const selectedCount = computeSelectedChapterCount(drawer, cachedBatchInfo);
    if (selectedCount === lastRefreshSelectedCount &&
        remaining === lastRefreshRemaining) {
        return;
    }
    lastRefreshSelectedCount = selectedCount;
    lastRefreshRemaining = remaining;
    updateQuotaInfo(freeRetranslateUI, remaining, cachedUsage.dailyRetranslateLimit, selectedCount);
}
// ---------------------------------------------------------------------------
// Free retranslate UI setup and execution
// ---------------------------------------------------------------------------
/**
 * Sets up the free retranslate UI in the drawer: fetches batch-info and usage,
 * injects the button, and wires the click handler.
 */
async function setupFreeRetranslateUI(drawer) {
    const rawId = parseRawId();
    const startOrder = parseStartOrder();
    const language = parseLanguage();
    if (rawId === null || startOrder === null) {
        return;
    }
    // Inject the UI immediately (button starts disabled).
    freeRetranslateUI = injectFreeRetranslateUI(drawer, {
        onClick: () => {
            void handleFreeRetranslateClick(drawer, rawId, language);
        },
    });
    // Fetch batch-info and usage in parallel.
    const [batchInfo, usage] = await Promise.all([ensureBatchInfo(), ensureUsage()]);
    if (freeRetranslateUI === null) {
        return; // Drawer was closed during fetch.
    }
    if (batchInfo === null) {
        freeRetranslateUI.quotaInfo.textContent = "Failed to load batch info. Try re-opening the drawer.";
        return;
    }
    if (usage === null) {
        freeRetranslateUI.quotaInfo.textContent = "Failed to load free quota info.";
        return;
    }
    const remaining = usage.dailyRetranslateLimit - usage.dailyRetranslateUsed;
    const selectedCount = computeSelectedChapterCount(drawer, batchInfo);
    updateQuotaInfo(freeRetranslateUI, remaining, usage.dailyRetranslateLimit, selectedCount);
    // Seed the refresh guard so identical follow-up refreshes are skipped.
    lastRefreshSelectedCount = selectedCount;
    lastRefreshRemaining = remaining;
}
/**
 * Handles the "Free Retranslate" button click: reads the selected batch size
 * and models, filters chapters, confirms with the user, and executes the free
 * batch retranslate with live progress.
 */
async function handleFreeRetranslateClick(drawer, rawId, language) {
    if (isRetranslating || freeRetranslateUI === null) {
        return;
    }
    const batchInfo = await ensureBatchInfo();
    if (batchInfo === null || freeRetranslateUI === null) {
        return;
    }
    const optionKey = readSelectedBatchOptionKey(drawer);
    if (optionKey === null) {
        freeRetranslateUI.quotaInfo.textContent = "Please select a batch size first.";
        return;
    }
    const selectedModelNames = readSelectedModelNames(drawer);
    const chapters = filterChaptersByModels(batchInfo, optionKey, selectedModelNames);
    if (chapters.length === 0) {
        freeRetranslateUI.quotaInfo.textContent =
            "No chapters match the selected models in this batch range.";
        return;
    }
    const usage = await ensureUsage(true);
    const remaining = usage !== null ? usage.dailyRetranslateLimit - usage.dailyRetranslateUsed : 0;
    if (remaining <= 0) {
        freeRetranslateUI.quotaInfo.textContent =
            "No free retranslates remaining today. Come back tomorrow!";
        return;
    }
    const willRetranslate = Math.min(chapters.length, remaining);
    const modelList = selectedModelNames.length > 0
        ? selectedModelNames.join(", ")
        : "all models";
    const confirmed = window.confirm(`Free Retranslate\n\n` +
        `Batch: ${optionKey.replace("next_", "Next ")} chapters\n` +
        `Model filter: ${modelList}\n` +
        `Matching chapters: ${chapters.length}\n` +
        `Free quota remaining: ${remaining}\n` +
        `Will retranslate: ${willRetranslate} chapter${willRetranslate === 1 ? "" : "s"}\n\n` +
        `This uses your FREE daily retranslate quota — no tickets will be spent.\n\n` +
        `Proceed?`);
    if (!confirmed || freeRetranslateUI === null) {
        return;
    }
    // Execute the free batch retranslate in the background. The persistent status
    // pill (on <body>) keeps progress visible even if the drawer is closed or the
    // reader navigates to another chapter, so reading continues uninterrupted.
    // Drawer element writes are guarded with isConnected so a re-rendered/closed
    // drawer never throws on stale references (dynamic DOM handling).
    isRetranslating = true;
    if (freeRetranslateUI !== null && freeRetranslateUI.progress.isConnected) {
        resetFreeRetranslateProgress(freeRetranslateUI);
    }
    ensureStatusPill();
    const modelNameByAiId = buildModelNameByAiId(batchInfo);
    let pillCompleted = 0;
    let pillFailed = 0;
    let pillSkipped = 0;
    const onProgress = (progress) => {
        if (progress.state === "completed") {
            pillCompleted += 1;
        }
        else if (progress.state === "failed") {
            pillFailed += 1;
        }
        else if (progress.state === "skipped") {
            pillSkipped += 1;
        }
        updateStatusPill({
            current: progress.current,
            total: progress.total,
            completed: pillCompleted,
            failed: pillFailed,
            skipped: pillSkipped,
        });
        if (freeRetranslateUI !== null && freeRetranslateUI.progress.isConnected) {
            updateFreeRetranslateProgress(freeRetranslateUI, progress);
        }
    };
    try {
        const result = await executeFreeBatchRetranslate({
            chapters,
            rawId,
            language,
            modelNameByAiId,
        }, onProgress);
        finishStatusPill({
            completed: result.completed,
            failed: result.failed,
            skipped: result.skipped,
            remainingQuota: result.remainingQuota,
        });
        // Update the drawer's in-page summary + quota display if still open.
        if (freeRetranslateUI !== null && freeRetranslateUI.progress.isConnected) {
            const summary = document.createElement("div");
            summary.style.fontWeight = "600";
            summary.style.marginTop = "8px";
            summary.textContent =
                `Done: ${result.completed} completed, ${result.failed} failed, ` +
                    `${result.skipped} skipped. ` +
                    `Free quota remaining: ${result.remainingQuota}.`;
            freeRetranslateUI.progress.appendChild(summary);
            const freshUsage = await ensureUsage(true);
            if (freshUsage !== null &&
                freeRetranslateUI !== null &&
                freeRetranslateUI.button.isConnected) {
                const newRemaining = freshUsage.dailyRetranslateLimit - freshUsage.dailyRetranslateUsed;
                const selectedCount = computeSelectedChapterCount(drawer, batchInfo);
                updateQuotaInfo(freeRetranslateUI, newRemaining, freshUsage.dailyRetranslateLimit, selectedCount);
                lastRefreshSelectedCount = selectedCount;
                lastRefreshRemaining = newRemaining;
            }
        }
    }
    catch {
        const errRemaining = cachedUsage !== null
            ? cachedUsage.dailyRetranslateLimit - cachedUsage.dailyRetranslateUsed
            : 0;
        finishStatusPill({
            completed: pillCompleted,
            failed: pillFailed + 1,
            skipped: pillSkipped,
            remainingQuota: errRemaining,
        });
    }
    finally {
        isRetranslating = false;
        if (freeRetranslateUI !== null && freeRetranslateUI.button.isConnected) {
            freeRetranslateUI.button.disabled = false;
        }
    }
}
// ---------------------------------------------------------------------------
// Drawer observation
// ---------------------------------------------------------------------------
let rescanTimer = null;
/**
 * Called (debounced) whenever the DOM changes. Annotates the drawer and sets up
 * the free retranslate UI when the drawer is open.
 */
async function onDrawerChange() {
    const drawer = document.querySelector(DRAWER_SELECTOR);
    if (drawer === null) {
        freeRetranslateUI = null;
        lastRefreshSelectedCount = -1;
        lastRefreshRemaining = -1;
        return;
    }
    // Annotate model rows with badge counts.
    const modelList = drawer.querySelector(MODEL_LIST_SELECTOR);
    if (modelList !== null) {
        annotateDrawer(modelList);
    }
    // Inject the free retranslate UI if not already present; otherwise refresh
    // its button state so batch-size/model selection changes keep the button
    // enabled/disabled and labelled correctly.
    const existingSection = drawer.querySelector(".wtr-free-rt-section");
    if (existingSection === null && !isRetranslating) {
        await setupFreeRetranslateUI(drawer);
    }
    else if (existingSection !== null && !isRetranslating) {
        refreshFreeRetranslateButton(drawer);
    }
}
const observer = new MutationObserver(() => {
    if (rescanTimer !== null) {
        return;
    }
    rescanTimer = window.setTimeout(() => {
        rescanTimer = null;
        void onDrawerChange();
    }, 200);
});
observer.observe(document.documentElement, { childList: true, subtree: true });
// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
// Inject styles once at startup so they're ready when the drawer opens.
injectFreeRetranslateStyles();
// Initial pass in case the drawer is already open.
void onDrawerChange();
console.info("[WTR Retranslate] active on", window.location.pathname);
// Menu command to manually re-scan candidates (uses a granted GM_ API).
GM_registerMenuCommand("Re-scan Retranslate Candidates", () => {
    void onDrawerChange();
});

/******/ })()
;