// Same-origin API clients and pure parsers for the WTR-Lab retranslate flows.
//
// These helpers talk ONLY to same-origin WTR-Lab endpoints via `fetch`
// (credentials: "same-origin"). No cookies are read, no tokens are stored, and
// no external HTTP is used. The parsers are pure functions over plain data so
// they can be unit-tested in isolation; they are never invoked during
// `npm test` / `npm run validate`.

import type {
	BatchChapter,
	BatchModel,
	BatchOption,
	FreeRetranslateResult,
	RefreshCostInfo,
	RetranslateCandidate,
	TaskStatus,
	UsageInfo,
} from "./types";

/** Parsed `batch-info` result: per-model quota/cost, balance, models, options. */
export interface BatchInfo {
	readonly ticketBalance: number;
	readonly freeQuotaByAiId: Map<string, number>;
	readonly unitCostByAiId: Map<string, number>;
	readonly models: readonly BatchModel[];
	readonly options: readonly BatchOption[];
	readonly eligible: number;
	readonly total: number;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
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
export function parseReaderGetResponse(payload: unknown): RetranslateCandidate[] {
	const candidates: RetranslateCandidate[] = [];

	if (typeof payload !== "object" || payload === null) {
		return candidates;
	}

	const root = payload as { data?: unknown };
	const chapters = root.data ?? payload;
	if (!Array.isArray(chapters)) {
		return candidates;
	}

	for (const entry of chapters) {
		if (typeof entry !== "object" || entry === null) {
			continue;
		}
		const record = entry as Record<string, unknown>;
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
export function parseBatchInfoResponse(payload: unknown): BatchInfo {
	const freeQuotaByAiId = new Map<string, number>();
	const unitCostByAiId = new Map<string, number>();
	const models: BatchModel[] = [];
	const options: BatchOption[] = [];
	let ticketBalance = 0;
	let eligible = 0;
	let total = 0;

	if (typeof payload !== "object" || payload === null) {
		return { ticketBalance, freeQuotaByAiId, unitCostByAiId, models, options, eligible, total };
	}

	const record = payload as Record<string, unknown>;
	ticketBalance = asNumber(record.ticket_balance ?? record.balance) ?? 0;
	eligible = asNumber(record.eligible) ?? 0;
	total = asNumber(record.total) ?? 0;

	// --- models array -------------------------------------------------------
	const modelList = (record.models ?? record.model_list) as unknown;
	if (Array.isArray(modelList)) {
		for (const model of modelList) {
			if (typeof model !== "object" || model === null) {
				continue;
			}
			const m = model as Record<string, unknown>;
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
	const optionList = record.options as unknown;
	if (Array.isArray(optionList)) {
		for (const opt of optionList) {
			if (typeof opt !== "object" || opt === null) {
				continue;
			}
			const o = opt as Record<string, unknown>;
			const chapters: BatchChapter[] = [];
			const chapterList = o.chapters as unknown;
			if (Array.isArray(chapterList)) {
				for (const ch of chapterList) {
					if (typeof ch !== "object" || ch === null) {
						continue;
					}
					const c = ch as Record<string, unknown>;
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
export function parseRefreshCostResponse(payload: unknown): RefreshCostInfo {
	if (typeof payload !== "object" || payload === null) {
		return { hasQuota: false, cost: 0, remaining: 0 };
	}
	const record = payload as Record<string, unknown>;
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
export function parseFreeRetranslateResponse(payload: unknown): FreeRetranslateResult {
	if (typeof payload !== "object" || payload === null) {
		return { success: false, remaining: 0, paidCost: 0 };
	}
	const record = payload as Record<string, unknown>;
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
export function parseTaskStatusResponse(payload: unknown): TaskStatus {
	if (typeof payload !== "object" || payload === null) {
		return { state: "failed", ratio: 0, isExpired: true };
	}
	const record = payload as Record<string, unknown>;
	const job = (record.job ?? record) as Record<string, unknown>;
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
export function parseUsageResponse(payload: unknown): UsageInfo {
	if (typeof payload !== "object" || payload === null) {
		return { dailyRetranslateLimit: 0, dailyRetranslateUsed: 0 };
	}
	const record = payload as Record<string, unknown>;
	const usage = (record.usage ?? record) as Record<string, unknown>;
	const retranslate = (usage.daily_retranslate ?? usage.dailyRetranslate) as Record<
		string,
		unknown
	>;
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
export async function fetchReaderGet(
	input: { novelId: number; chapterIds: ReadonlyArray<number> },
	fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
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
export async function fetchBatchInfo(
	input: { rawId: number; startOrder: number },
	fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
	const params = new URLSearchParams();
	params.set("raw_id", String(input.rawId));
	params.set("start_order", String(input.startOrder));

	const response = await fetchImpl(
		`/api/v2/chapter/retranslate/batch-info?${params.toString()}`,
		{
			method: "GET",
			credentials: "same-origin",
		},
	);
	if (!response.ok) {
		throw new Error(`batch-info failed: ${response.status}`);
	}
	return response.json();
}

/**
 * Same-origin fetch wrapper for `refresh-cost` (GET /api/v2/chapter/refresh-cost).
 * Checks whether a free retranslate quota is available for the given chapter.
 */
export async function fetchRefreshCost(
	chapterId: number,
	fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
	const params = new URLSearchParams();
	params.set("chapter_id", String(chapterId));
	params.set("type", "translate");

	const response = await fetchImpl(
		`/api/v2/chapter/refresh-cost?${params.toString()}`,
		{
			method: "GET",
			credentials: "same-origin",
		},
	);
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
export async function triggerFreeRetranslate(
	input: { rawId: number; chapterId: number; language: string },
	fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
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
export async function pollRetranslateTask(
	input: {
		chapterId: number;
		rawId: number;
		language: string;
		taskId: string;
	},
	fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
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
export async function fetchUsage(fetchImpl: typeof fetch = fetch): Promise<unknown> {
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
export async function fetchChapterTask(
	input: { rawId: number; chapterId: number; chapterNo: number; language: string },
	fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
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
export function parseChapterTaskId(
	payload: unknown,
	chapterId: number,
): string | undefined {
	if (typeof payload !== "object" || payload === null) {
		return undefined;
	}
	const record = payload as Record<string, unknown>;
	const tasks = record.tasks;
	if (!Array.isArray(tasks)) {
		return undefined;
	}
	for (const task of tasks) {
		if (typeof task !== "object" || task === null) {
			continue;
		}
		const t = task as Record<string, unknown>;
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
export function parseChapterStatus(payload: unknown): number | undefined {
	if (typeof payload !== "object" || payload === null) {
		return undefined;
	}
	const record = payload as Record<string, unknown>;
	const data = record.data;
	if (typeof data !== "object" || data === null) {
		return undefined;
	}
	return asNumber((data as Record<string, unknown>).status);
}
