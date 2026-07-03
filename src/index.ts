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

import { groupCandidatesByAiId } from "./retranslate/candidates";
import {
	integrateRetranslateIntoDom,
	injectFreeRetranslateUI,
	injectFreeRetranslateStyles,
	readSelectedBatchOptionKey,
	readSelectedModelNames,
	updateFreeRetranslateProgress,
	updateQuotaInfo,
	resetFreeRetranslateProgress,
	ensureStatusPill,
	updateStatusPill,
	finishStatusPill,
} from "./retranslate/domIntegration";
import type { FreeRetranslateUIElements } from "./retranslate/domIntegration";
import {
	fetchBatchInfo,
	fetchUsage,
	parseBatchInfoResponse,
	parseUsageResponse,
} from "./retranslate/api";
import type { BatchInfo } from "./retranslate/api";
import { executeFreeBatchRetranslate } from "./retranslate/retranslate";
import type { BatchChapter, FreeBatchProgress, UsageInfo } from "./retranslate/types";

const MODEL_LIST_SELECTOR = ".brt-model-list";
const DRAWER_SELECTOR = ".batch-unlock-canvas";

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/** Parses the novel raw id from the same-origin URL path (`/en/novel/<id>/...`). */
function parseRawId(): number | null {
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
function parseStartOrder(): number | null {
	const match = window.location.pathname.match(/chapter-(\d+)/);
	if (match === null) {
		return null;
	}
	const order = Number.parseInt(match[1], 10);
	return Number.isFinite(order) ? order : null;
}

/** Parses the language code from the URL path (e.g. `/en/novel/…` → `"en"`). */
function parseLanguage(): string {
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
function collectCandidatesFromDrawer(modelList: HTMLElement) {
	const candidates: Array<{ chapterId: number; chapterNo: number; ai_id: string }> = [];
	const rows = Array.from(modelList.querySelectorAll<HTMLElement>(MODEL_ROW_SELECTOR));

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
function annotateDrawer(modelList: HTMLElement): void {
	const candidatesByAiId = groupCandidatesByAiId(collectCandidatesFromDrawer(modelList));
	integrateRetranslateIntoDom({ modelList, candidatesByAiId });
}

// ---------------------------------------------------------------------------
// Cached batch-info and usage
// ---------------------------------------------------------------------------

let cachedBatchInfo: BatchInfo | null = null;
let cachedBatchInfoKey = "";
let cachedUsage: UsageInfo | null = null;
let cachedUsageTime = 0;
let freeRetranslateUI: FreeRetranslateUIElements | null = null;
let isRetranslating = false;

const USAGE_CACHE_TTL_MS = 30_000;

/** Fetches and caches batch-info for the current novel/chapter. */
async function ensureBatchInfo(): Promise<BatchInfo | null> {
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
	} catch {
		return null;
	}
}

/** Fetches and caches usage (free retranslate quota) with a short TTL. */
async function ensureUsage(force = false): Promise<UsageInfo | null> {
	const now = Date.now();
	if (
		!force &&
		cachedUsage !== null &&
		now - cachedUsageTime < USAGE_CACHE_TTL_MS
	) {
		return cachedUsage;
	}

	try {
		const payload = await fetchUsage();
		cachedUsage = parseUsageResponse(payload);
		cachedUsageTime = now;
		return cachedUsage;
	} catch {
		return null;
	}
}

/**
 * Builds a map from numeric aiId → model name using the batch-info models array.
 */
function buildModelNameByAiId(
	batchInfo: BatchInfo,
): Map<number, string> {
	const map = new Map<number, string>();
	for (const model of batchInfo.models) {
		map.set(model.aiId, model.name);
	}
	return map;
}

/**
 * Filters chapters from the selected batch option by the selected model names.
 * If no models are selected, all chapters in the option are returned.
 */
function filterChaptersByModels(
	batchInfo: BatchInfo,
	optionKey: string,
	selectedModelNames: readonly string[],
): BatchChapter[] {
	const option = batchInfo.options.find((o) => o.key === optionKey);
	if (option === undefined) {
		return [];
	}

	if (selectedModelNames.length === 0) {
		return [...option.chapters];
	}

	// Build a set of selected aiIds by matching model names.
	const nameToAiId = new Map<string, number>();
	for (const model of batchInfo.models) {
		nameToAiId.set(model.name, model.aiId);
	}

	const selectedAiIds = new Set<number>();
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
function computeSelectedChapterCount(
	drawer: HTMLElement,
	batchInfo: BatchInfo,
): number {
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
function refreshFreeRetranslateButton(drawer: HTMLElement): void {
	if (freeRetranslateUI === null || isRetranslating) {
		return;
	}
	if (cachedBatchInfo === null || cachedUsage === null) {
		return;
	}
	const remaining =
		cachedUsage.dailyRetranslateLimit - cachedUsage.dailyRetranslateUsed;
	const selectedCount = computeSelectedChapterCount(drawer, cachedBatchInfo);
	if (
		selectedCount === lastRefreshSelectedCount &&
		remaining === lastRefreshRemaining
	) {
		return;
	}
	lastRefreshSelectedCount = selectedCount;
	lastRefreshRemaining = remaining;
	updateQuotaInfo(
		freeRetranslateUI,
		remaining,
		cachedUsage.dailyRetranslateLimit,
		selectedCount,
	);
}

// ---------------------------------------------------------------------------
// Free retranslate UI setup and execution
// ---------------------------------------------------------------------------

/**
 * Sets up the free retranslate UI in the drawer: fetches batch-info and usage,
 * injects the button, and wires the click handler.
 */
async function setupFreeRetranslateUI(drawer: HTMLElement): Promise<void> {
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
	updateQuotaInfo(
		freeRetranslateUI,
		remaining,
		usage.dailyRetranslateLimit,
		selectedCount,
	);
	// Seed the refresh guard so identical follow-up refreshes are skipped.
	lastRefreshSelectedCount = selectedCount;
	lastRefreshRemaining = remaining;
}

/**
 * Handles the "Free Retranslate" button click: reads the selected batch size
 * and models, filters chapters, confirms with the user, and executes the free
 * batch retranslate with live progress.
 */
async function handleFreeRetranslateClick(
	drawer: HTMLElement,
	rawId: number,
	language: string,
): Promise<void> {
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
	const remaining =
		usage !== null ? usage.dailyRetranslateLimit - usage.dailyRetranslateUsed : 0;

	if (remaining <= 0) {
		freeRetranslateUI.quotaInfo.textContent =
			"No free retranslates remaining today. Come back tomorrow!";
		return;
	}

	const willRetranslate = Math.min(chapters.length, remaining);
	const modelList =
		selectedModelNames.length > 0
			? selectedModelNames.join(", ")
			: "all models";

	const confirmed = window.confirm(
		`Free Retranslate\n\n` +
			`Batch: ${optionKey.replace("next_", "Next ")} chapters\n` +
			`Model filter: ${modelList}\n` +
			`Matching chapters: ${chapters.length}\n` +
			`Free quota remaining: ${remaining}\n` +
			`Will retranslate: ${willRetranslate} chapter${willRetranslate === 1 ? "" : "s"}\n\n` +
			`This uses your FREE daily retranslate quota — no tickets will be spent.\n\n` +
			`Proceed?`,
	);
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

	const onProgress = (progress: FreeBatchProgress): void => {
		if (progress.state === "completed") {
			pillCompleted += 1;
		} else if (progress.state === "failed") {
			pillFailed += 1;
		} else if (progress.state === "skipped") {
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
		const result = await executeFreeBatchRetranslate(
			{
				chapters,
				rawId,
				language,
				modelNameByAiId,
			},
			onProgress,
		);

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
			if (
				freshUsage !== null &&
				freeRetranslateUI !== null &&
				freeRetranslateUI.button.isConnected
			) {
				const newRemaining = freshUsage.dailyRetranslateLimit - freshUsage.dailyRetranslateUsed;
				const selectedCount = computeSelectedChapterCount(drawer, batchInfo);
				updateQuotaInfo(
					freeRetranslateUI,
					newRemaining,
					freshUsage.dailyRetranslateLimit,
					selectedCount,
				);
				lastRefreshSelectedCount = selectedCount;
				lastRefreshRemaining = newRemaining;
			}
		}
	} catch {
		const errRemaining =
			cachedUsage !== null
				? cachedUsage.dailyRetranslateLimit - cachedUsage.dailyRetranslateUsed
				: 0;
		finishStatusPill({
			completed: pillCompleted,
			failed: pillFailed + 1,
			skipped: pillSkipped,
			remainingQuota: errRemaining,
		});
	} finally {
		isRetranslating = false;
		if (freeRetranslateUI !== null && freeRetranslateUI.button.isConnected) {
			freeRetranslateUI.button.disabled = false;
		}
	}
}

// ---------------------------------------------------------------------------
// Drawer observation
// ---------------------------------------------------------------------------

let rescanTimer: number | null = null;

/**
 * Called (debounced) whenever the DOM changes. Annotates the drawer and sets up
 * the free retranslate UI when the drawer is open.
 */
async function onDrawerChange(): Promise<void> {
	const drawer = document.querySelector<HTMLElement>(DRAWER_SELECTOR);
	if (drawer === null) {
		freeRetranslateUI = null;
		lastRefreshSelectedCount = -1;
		lastRefreshRemaining = -1;
		return;
	}

	// Annotate model rows with badge counts.
	const modelList = drawer.querySelector<HTMLElement>(MODEL_LIST_SELECTOR);
	if (modelList !== null) {
		annotateDrawer(modelList);
	}

	// Inject the free retranslate UI if not already present; otherwise refresh
	// its button state so batch-size/model selection changes keep the button
	// enabled/disabled and labelled correctly.
	const existingSection = drawer.querySelector(".wtr-free-rt-section");
	if (existingSection === null && !isRetranslating) {
		await setupFreeRetranslateUI(drawer);
	} else if (existingSection !== null && !isRetranslating) {
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
