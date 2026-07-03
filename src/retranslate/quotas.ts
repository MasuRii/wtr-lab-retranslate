import type { FreeQuotaGuardInput, PaidBatchGuardInput, QuotaDecision } from "./types";

/**
 * Evaluates whether a free-quota retranslate batch stays within each model's free
 * quota. Must never allow a batch that would exceed the free quota (no bypassing).
 *
 * Quota is tracked per `ai_id`. A model that is absent from `freeQuotaByAiId` is
 * treated as having zero free quota — the conservative choice that never bypasses
 * the quota. When a group exceeds its quota, the decision reports that group's
 * requested/available figures; otherwise it reports the batch totals.
 */
export function evaluateFreeQuotaGuard(input: FreeQuotaGuardInput): QuotaDecision {
	let totalRequested = 0;
	let totalAvailable = 0;

	for (const [ai_id, candidates] of input.candidatesByAiId) {
		const requested = candidates.length;
		const available = input.freeQuotaByAiId.get(ai_id) ?? 0;
		totalRequested += requested;
		totalAvailable += available;

		if (requested > available) {
			return {
				allowed: false,
				reason: `Free quota exceeded for "${ai_id}": requested ${requested}, available ${available}.`,
				requested,
				available,
			};
		}
	}

	return {
		allowed: true,
		requested: totalRequested,
		available: totalAvailable,
	};
}

/** Rounds a ticket cost to two decimal places to avoid floating-point drift. */
function roundCost(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Evaluates whether a paid retranslate batch is affordable against the user's
 * ticket balance. Must never allow a batch whose total cost exceeds the balance
 * (no bypassing payments). Unknown per-model costs are treated conservatively:
 * the batch is blocked rather than priced at zero, so payment is never bypassed.
 */
export function evaluatePaidBatchGuard(input: PaidBatchGuardInput): QuotaDecision {
	let totalCost = 0;

	for (const [ai_id, candidates] of input.candidatesByAiId) {
		const unitCost = input.unitCostByAiId.get(ai_id);
		if (unitCost === undefined) {
			return {
				allowed: false,
				reason: `Unknown per-chapter cost for model "${ai_id}"; refusing to bypass payment safety.`,
				requested: candidates.length,
				available: input.ticketBalance,
			};
		}
		totalCost += unitCost * candidates.length;
	}

	const requested = roundCost(totalCost);
	const available = input.ticketBalance;

	if (requested > available) {
		return {
			allowed: false,
			reason: `Batch cost ${requested} exceeds ticket balance ${available}; cannot afford.`,
			requested,
			available,
		};
	}

	return {
		allowed: true,
		requested,
		available,
	};
}
