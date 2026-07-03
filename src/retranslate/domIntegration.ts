import type {
	DomIntegrationInput,
	DomIntegrationResult,
	FreeBatchProgress,
} from "./types";

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
export function integrateRetranslateIntoDom(input: DomIntegrationInput): DomIntegrationResult {
	const { modelList, candidatesByAiId } = input;
	const rows = Array.from(modelList.querySelectorAll<HTMLElement>(".brt-model-row"));
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
		badge.setAttribute(
			"aria-label",
			`${count} retranslate candidate${count === 1 ? "" : "s"} for ${modelName}`,
		);
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
export function injectFreeRetranslateStyles(): void {
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
export function readSelectedBatchOptionKey(drawer: HTMLElement): string | null {
	const selected = drawer.querySelector<HTMLElement>(".buc-option.is-selected");
	if (selected === null) {
		return null;
	}
	const label =
		selected.querySelector(".buc-option-label")?.textContent ??
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
export function readSelectedModelNames(drawer: HTMLElement): string[] {
	const rows = Array.from(drawer.querySelectorAll<HTMLElement>(".brt-model-row.is-selected"));
	const names: string[] = [];
	for (const row of rows) {
		const name = row.querySelector(".brt-model-name")?.textContent?.trim();
		if (name !== undefined && name !== "") {
			names.push(name);
		}
	}
	return names;
}

/** Options for {@link injectFreeRetranslateUI}. */
export interface FreeRetranslateUIOptions {
	/** Called when the Free Retranslate button is clicked. */
	readonly onClick: () => void;
}

/** Elements created by {@link injectFreeRetranslateUI}, for later updates. */
export interface FreeRetranslateUIElements {
	readonly section: HTMLElement;
	readonly button: HTMLButtonElement;
	readonly quotaInfo: HTMLElement;
	readonly progress: HTMLElement;
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
export function injectFreeRetranslateUI(
	drawer: HTMLElement,
	options: FreeRetranslateUIOptions,
): FreeRetranslateUIElements {
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
	} else {
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
export function updateQuotaInfo(
	elements: FreeRetranslateUIElements,
	remaining: number,
	limit: number,
	selectedCount: number,
): void {
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
export function updateFreeRetranslateProgress(
	elements: FreeRetranslateUIElements,
	progress: FreeBatchProgress,
): void {
	elements.progress.style.display = "block";
	elements.button.disabled = true;

	// Build or update the overall summary line.
	let summary = elements.progress.querySelector<HTMLElement>(".wtr-free-rt-summary");
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
	let item = elements.progress.querySelector<HTMLElement>(`#${itemId}`);
	if (item === null) {
		item = document.createElement("div");
		item.id = itemId;
		item.className = "wtr-free-rt-item";
		elements.progress.appendChild(item);
	}

	const icon =
		progress.state === "completed"
			? "✓"
			: progress.state === "failed"
				? "✗"
				: progress.state === "skipped"
					? "⊘"
					: "⟳";
	const cls =
		progress.state === "completed"
			? "wtr-free-rt-ok"
			: progress.state === "failed"
				? "wtr-free-rt-err"
				: progress.state === "skipped"
					? "wtr-free-rt-skip"
					: "wtr-free-rt-active";

	item.className = `wtr-free-rt-item ${cls}`;
	item.textContent = `${icon} Ch. ${progress.chapterOrder} — ${progress.modelName}${
		progress.message !== undefined ? ` (${progress.message})` : ""
	}`;
}

/**
 * Resets the progress container (hides it and clears all items).
 */
export function resetFreeRetranslateProgress(elements: FreeRetranslateUIElements): void {
	elements.progress.style.display = "none";
	elements.progress.innerHTML = "";
}

// ---------------------------------------------------------------------------
// Persistent background status pill (survives drawer close / SPA navigation)
// ---------------------------------------------------------------------------

const STATUS_PILL_ID = "wtr-free-rt-status-pill";
let pillHideTimer: number | null = null;

/**
 * Returns the persistent status pill, creating it (appended to <body>) if it
 * does not exist. Because it lives on <body> rather than inside the
 * React-managed drawer, it survives drawer close/reopen and client-side
 * navigation, so background retranslate progress stays visible while reading.
 * Never a modal/overlay — just a small, non-blocking status indicator.
 */
export function ensureStatusPill(): HTMLElement {
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
export function updateStatusPill(state: {
	current: number;
	total: number;
	completed: number;
	failed: number;
	skipped: number;
}): void {
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
export function finishStatusPill(summary: {
	completed: number;
	failed: number;
	skipped: number;
	remainingQuota: number;
}): void {
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
export function removeStatusPill(): void {
	if (pillHideTimer !== null) {
		clearTimeout(pillHideTimer);
		pillHideTimer = null;
	}
	document.getElementById(STATUS_PILL_ID)?.remove();
}
