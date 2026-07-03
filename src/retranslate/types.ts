// src/retranslate/types.ts
// Shared domain types for WTR Lab Retranslate.
//
// Types only — no runtime behaviour. These describe the API surface exercised
// by the tests under test/retranslate/ and the runtime entry point in index.ts.

/**
 * A chapter that is a candidate for re-translation.
 *
 * `ai_id` is the identifier of the AI model that produced the chapter's current
 * translation. Candidates are grouped by `ai_id` so batches can be scoped to a
 * single model (matching the WTR-Lab Batch Re-Translate drawer's model rows).
 */
export interface RetranslateCandidate {
	readonly chapterId: number;
	readonly chapterNo: number;
	readonly ai_id: string;
}

/**
 * Outcome of a quota/payment guard check. The script must never bypass
 * quotas or payments, so a blocked decision (`allowed: false`) is final.
 */
export interface QuotaDecision {
	readonly allowed: boolean;
	readonly reason?: string;
	/** Requested amount: candidate count (free quota) or total ticket cost (paid). */
	readonly requested: number;
	/** Available amount: remaining free quota or ticket balance. */
	readonly available: number;
}

/** Input for the free-quota guard. Free quota is tracked per `ai_id` (model). */
export interface FreeQuotaGuardInput {
	readonly candidatesByAiId: ReadonlyMap<string, readonly RetranslateCandidate[]>;
	readonly freeQuotaByAiId: ReadonlyMap<string, number>;
}

/** Input for the paid-batch guard. Ticket balance is a single shared wallet. */
export interface PaidBatchGuardInput {
	readonly candidatesByAiId: ReadonlyMap<string, readonly RetranslateCandidate[]>;
	readonly ticketBalance: number;
	/** Ticket cost to re-translate a single chapter for a given model. */
	readonly unitCostByAiId: ReadonlyMap<string, number>;
}

/** Input for DOM integration into the existing Batch Re-Translate drawer. */
export interface DomIntegrationInput {
	/** The existing `.brt-model-list` element from the drawer (see DomSelectors.md). */
	readonly modelList: HTMLElement;
	readonly candidatesByAiId: ReadonlyMap<string, readonly RetranslateCandidate[]>;
}

/** Result of DOM integration. Used by tests to prove no modal/dialog was created. */
export interface DomIntegrationResult {
	readonly annotatedRowCount: number;
	readonly createdDialogCount: number;
	readonly createdOverlayCount: number;
}

// ---------------------------------------------------------------------------
// Batch-info response types (from GET /api/v2/chapter/retranslate/batch-info)
// ---------------------------------------------------------------------------

/** A single chapter entry inside a batch-info option's `chapters` array. */
export interface BatchChapter {
	/** WTR-Lab internal chapter id (used in refresh-request / reader/task). */
	readonly id: number;
	/** Chapter order / number (e.g. 1790). */
	readonly order: number;
	/** Numeric AI model id that produced the current translation (e.g. 101). */
	readonly aiId: number;
	/** Ticket cost to re-translate this chapter via the paid batch endpoint. */
	readonly cost: number;
}

/** A model entry from the batch-info `models` array. */
export interface BatchModel {
	readonly aiId: number;
	readonly name: string;
	readonly count: number;
	readonly cost: number;
}

/** A batch-size option from the batch-info `options` array (next_3, next_5, …). */
export interface BatchOption {
	readonly key: string;
	readonly label: string;
	readonly count: number;
	readonly cost: number;
	readonly firstOrder: number;
	readonly lastOrder: number;
	readonly chapters: readonly BatchChapter[];
}

// ---------------------------------------------------------------------------
// Free-retranslate API types
// ---------------------------------------------------------------------------

/** Parsed `refresh-cost` response (GET /api/v2/chapter/refresh-cost). */
export interface RefreshCostInfo {
	readonly hasQuota: boolean;
	readonly cost: number;
	readonly remaining: number;
}

/** Parsed `refresh-request` response (POST /api/serie/refresh-request). */
export interface FreeRetranslateResult {
	readonly success: boolean;
	/** Remaining free daily quota after this retranslate. */
	readonly remaining: number;
	/** Tickets charged (0 for free retranslates). */
	readonly paidCost: number;
}

/** Parsed `reader/task` response (POST /api/reader/task). */
export interface TaskStatus {
	/** "active" | "completed" | "failed" | … */
	readonly state: string;
	readonly ratio: number;
	readonly isExpired: boolean;
}

/** Parsed `profile/usage` response (GET /api/profile/usage). */
export interface UsageInfo {
	readonly dailyRetranslateLimit: number;
	readonly dailyRetranslateUsed: number;
}

/** Progress update emitted during free batch retranslate execution. */
export interface FreeBatchProgress {
	/** 1-indexed position of the current chapter in the batch. */
	readonly current: number;
	/** Total chapters in the batch. */
	readonly total: number;
	readonly chapterId: number;
	readonly chapterOrder: number;
	readonly modelName: string;
	readonly state: "pending" | "translating" | "completed" | "failed" | "skipped";
	readonly message?: string;
	/** Remaining free quota after the latest action (when known). */
	readonly remainingQuota?: number;
}
