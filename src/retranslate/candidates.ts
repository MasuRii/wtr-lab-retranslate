import type { RetranslateCandidate } from "./types";

/**
 * Groups retranslate candidates by their `ai_id` (the AI model that produced the
 * current translation), preserving insertion order within each group.
 *
 * The input array is never mutated: a fresh `Map` of fresh arrays is returned,
 * so callers can safely pass a frozen/read-only candidate list.
 */
export function groupCandidatesByAiId(
	candidates: ReadonlyArray<RetranslateCandidate>,
): Map<string, RetranslateCandidate[]> {
	const grouped = new Map<string, RetranslateCandidate[]>();

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
