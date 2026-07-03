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

import {
	fetchChapterTask,
	fetchRefreshCost,
	parseChapterStatus,
	parseChapterTaskId,
	parseFreeRetranslateResponse,
	parseRefreshCostResponse,
	parseTaskStatusResponse,
	pollRetranslateTask,
	triggerFreeRetranslate,
} from "./api";
import { evaluateFreeQuotaGuard, evaluatePaidBatchGuard } from "./quotas";
import type {
	BatchChapter,
	FreeBatchProgress,
	FreeQuotaGuardInput,
	PaidBatchGuardInput,
	QuotaDecision,
	RetranslateCandidate,
} from "./types";

/** Outcome of a guarded retranslate action. */
export interface GuardedActionResult {
	readonly decision: QuotaDecision;
	/** True only when the caller confirmed AND the action ran. */
	readonly executed: boolean;
}

/** Prepared (non-submitted) paid batch summary for review/confirmation. */
export interface PreparedPaidBatch {
	readonly decision: QuotaDecision;
	readonly candidatesByAiId: ReadonlyMap<string, readonly RetranslateCandidate[]>;
}

/**
 * Runs the free-quota guard, then — only if allowed — asks the caller to confirm
 * before performing the mutation. Stops with `executed: false` when the guard
 * blocks (no/over quota) or the caller declines. Never bypasses the free quota.
 */
export async function prepareFreeRetranslate(
	input: FreeQuotaGuardInput,
	confirm: () => Promise<boolean>,
	mutate: () => Promise<void>,
): Promise<GuardedActionResult> {
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
export function preparePaidBatch(input: PaidBatchGuardInput): PreparedPaidBatch {
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
export async function submitPaidBatch(
	prepared: PreparedPaidBatch,
	confirm: () => Promise<boolean>,
	submit: () => Promise<void>,
): Promise<GuardedActionResult> {
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

// ---------------------------------------------------------------------------
// Free batch retranslate execution
// ---------------------------------------------------------------------------

/** Input for {@link executeFreeBatchRetranslate}. */
export interface FreeBatchRetranslateInput {
	/** Chapters to retranslate (already filtered by model). */
	readonly chapters: readonly BatchChapter[];
	/** Novel raw id (from the URL). */
	readonly rawId: number;
	/** Language code (e.g. "en", parsed from the URL). */
	readonly language: string;
	/** Map from numeric aiId → model name (for progress reporting). */
	readonly modelNameByAiId: ReadonlyMap<number, string>;
	/** Injectable fetch (defaults to page fetch). */
	readonly fetchImpl?: typeof fetch;
	/** Poll interval in ms (default 2000). */
	readonly pollIntervalMs?: number;
	/** Max poll duration in ms before giving up on a single chapter (default 180000). */
	readonly pollTimeoutMs?: number;
}

/**
 * Result of a free batch retranslate execution.
 */
export interface FreeBatchRetranslateResult {
	readonly completed: number;
	readonly failed: number;
	readonly skipped: number;
	readonly remainingQuota: number;
}

/** Default poll interval (2 seconds, matching the site's own polling cadence). */
const DEFAULT_POLL_INTERVAL_MS = 2000;
/** Default poll timeout (3 minutes per chapter). */
const DEFAULT_POLL_TIMEOUT_MS = 180_000;

function sleep(ms: number): Promise<void> {
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
export async function executeFreeBatchRetranslate(
	input: FreeBatchRetranslateInput,
	onProgress: (progress: FreeBatchProgress) => void,
): Promise<FreeBatchRetranslateResult> {
	const {
		chapters,
		rawId,
		language,
		modelNameByAiId,
		fetchImpl = fetch,
		pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
		pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
	} = input;

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
		} catch {
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
			const refreshPayload = await triggerFreeRetranslate(
				{ rawId, chapterId: ch.id, language },
				fetchImpl,
			);
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
			let taskId: string | undefined;
			let taskDone = false;
			for (
				let attempt = 0;
				attempt < 3 && taskId === undefined && !taskDone;
				attempt += 1
			) {
				if (attempt > 0) {
					await sleep(pollIntervalMs);
				}
				try {
					const chapterPayload = await fetchChapterTask(
						{ rawId, chapterId: ch.id, chapterNo: ch.order, language },
						fetchImpl,
					);
					taskId = parseChapterTaskId(chapterPayload, ch.id);
					if (
						taskId === undefined &&
						parseChapterStatus(chapterPayload) === 4
					) {
						// Translation already finished before we could poll.
						taskDone = true;
					}
				} catch {
					// reader/get failed (possibly a Turnstile challenge); retry.
				}
			}

			// Poll reader/task with the real task_id until completed or timeout.
			if (!taskDone && taskId !== undefined) {
				const startTime = Date.now();
				while (Date.now() - startTime < pollTimeoutMs) {
					await sleep(pollIntervalMs);
					try {
						const taskPayload = await pollRetranslateTask(
							{ chapterId: ch.id, rawId, language, taskId },
							fetchImpl,
						);
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
					} catch {
						// Transient poll error — keep trying until timeout.
					}
				}
			} else if (!taskDone) {
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
						const chapterPayload = await fetchChapterTask(
							{ rawId, chapterId: ch.id, chapterNo: ch.order, language },
							fetchImpl,
						);
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
						} else {
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
					} catch {
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
			} else {
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
		} catch {
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
