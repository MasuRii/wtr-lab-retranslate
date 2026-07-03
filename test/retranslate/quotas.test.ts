// test/retranslate/quotas.test.ts
import { evaluateFreeQuotaGuard, evaluatePaidBatchGuard } from "../../src/retranslate/quotas";
import type { RetranslateCandidate } from "../../src/retranslate/types";

function candidate(chapterId: number, ai_id: string): RetranslateCandidate {
	return { chapterId, chapterNo: chapterId, ai_id };
}

/** Builds a grouped map without depending on groupCandidatesByAiId (keeps tests isolated). */
function groupManual(entries: Array<[string, number]>): Map<string, RetranslateCandidate[]> {
	const map = new Map<string, RetranslateCandidate[]>();
	for (const [ai_id, count] of entries) {
		const arr: RetranslateCandidate[] = [];
		for (let i = 0; i < count; i++) {
			arr.push(candidate(1000 + i, ai_id));
		}
		map.set(ai_id, arr);
	}
	return map;
}

describe("evaluateFreeQuotaGuard", () => {
	it("allows when every ai_id group stays within its free quota", () => {
		const candidatesByAiId = groupManual([
			["gemini-3.0-flash", 2],
			["gemini-3.1-flash-lite", 1],
		]);
		const freeQuotaByAiId = new Map([
			["gemini-3.0-flash", 5],
			["gemini-3.1-flash-lite", 5],
		]);

		const decision = evaluateFreeQuotaGuard({ candidatesByAiId, freeQuotaByAiId });

		expect(decision.allowed).toBe(true);
		expect(decision.reason).toBeUndefined();
	});

	it("blocks when a group exceeds its per-model free quota (must not bypass quota)", () => {
		const candidatesByAiId = groupManual([["gemini-3.0-flash", 6]]);
		const freeQuotaByAiId = new Map([["gemini-3.0-flash", 5]]);

		const decision = evaluateFreeQuotaGuard({ candidatesByAiId, freeQuotaByAiId });

		expect(decision.allowed).toBe(false);
		expect(decision.reason).toMatch(/quota/i);
		expect(decision.requested).toBe(6);
		expect(decision.available).toBe(5);
	});

	it("blocks when free quota is zero for a model that has candidates", () => {
		const candidatesByAiId = groupManual([["model-a", 1]]);
		const freeQuotaByAiId = new Map([["model-a", 0]]);

		const decision = evaluateFreeQuotaGuard({ candidatesByAiId, freeQuotaByAiId });

		expect(decision.allowed).toBe(false);
	});
});

describe("evaluatePaidBatchGuard", () => {
	it("allows when total batch cost is within the ticket balance", () => {
		const candidatesByAiId = groupManual([
			["model-a", 2],
			["model-b", 1],
		]);
		const unitCostByAiId = new Map([
			["model-a", 3.37],
			["model-b", 5.25],
		]);

		const decision = evaluatePaidBatchGuard({
			candidatesByAiId,
			ticketBalance: 100,
			unitCostByAiId,
		});

		expect(decision.allowed).toBe(true);
		expect(decision.reason).toBeUndefined();
	});

	it("blocks when total batch cost exceeds the ticket balance (must not bypass payment)", () => {
		const candidatesByAiId = groupManual([["model-a", 3]]);
		const unitCostByAiId = new Map([["model-a", 10.11]]);

		const decision = evaluatePaidBatchGuard({
			candidatesByAiId,
			ticketBalance: 20,
			unitCostByAiId,
		});

		expect(decision.allowed).toBe(false);
		expect(decision.reason).toMatch(/balance|payment|cost|afford/i);
		expect(decision.requested).toBeCloseTo(30.33, 2);
		expect(decision.available).toBe(20);
	});

	it("blocks conservatively when a model's per-chapter cost is unknown (never bypass payment)", () => {
		const candidatesByAiId = groupManual([["unknown-model", 5]]);
		const unitCostByAiId = new Map<string, number>();

		const decision = evaluatePaidBatchGuard({
			candidatesByAiId,
			ticketBalance: 1000,
			unitCostByAiId,
		});

		expect(decision.allowed).toBe(false);
		expect(decision.reason).toMatch(/cost|unknown|price|afford/i);
	});
});
