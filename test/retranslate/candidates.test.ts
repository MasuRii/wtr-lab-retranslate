// test/retranslate/candidates.test.ts
import { groupCandidatesByAiId } from "../../src/retranslate/candidates";
import type { RetranslateCandidate } from "../../src/retranslate/types";

function candidate(chapterId: number, ai_id: string, chapterNo = chapterId): RetranslateCandidate {
	return { chapterId, chapterNo, ai_id };
}

describe("groupCandidatesByAiId", () => {
	it("groups candidates into separate buckets keyed by ai_id", () => {
		const candidates = [
			candidate(1, "gemini-3.0-flash"),
			candidate(2, "gemini-3.1-flash-lite"),
			candidate(3, "gemini-3.0-flash"),
		];

		const grouped = groupCandidatesByAiId(candidates);

		expect(grouped).toBeInstanceOf(Map);
		expect(grouped.size).toBe(2);
		expect(grouped.get("gemini-3.0-flash")?.map((c) => c.chapterId)).toEqual([1, 3]);
		expect(grouped.get("gemini-3.1-flash-lite")?.map((c) => c.chapterId)).toEqual([2]);
	});

	it("preserves insertion order of candidates within each ai_id group", () => {
		const candidates = [
			candidate(10, "model-a"),
			candidate(11, "model-b"),
			candidate(12, "model-a"),
			candidate(13, "model-a"),
			candidate(14, "model-b"),
		];

		const grouped = groupCandidatesByAiId(candidates);

		expect(grouped.get("model-a")?.map((c) => c.chapterId)).toEqual([10, 12, 13]);
		expect(grouped.get("model-b")?.map((c) => c.chapterId)).toEqual([11, 14]);
	});

	it("returns an empty map when there are no candidates", () => {
		const grouped = groupCandidatesByAiId([]);

		expect(grouped).toBeInstanceOf(Map);
		expect(grouped.size).toBe(0);
	});

	it("does not mutate the input array", () => {
		const candidates = [candidate(1, "model-a"), candidate(2, "model-b")];
		const snapshot = [...candidates];

		groupCandidatesByAiId(candidates);

		expect(candidates).toEqual(snapshot);
	});
});
