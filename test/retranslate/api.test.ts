// test/retranslate/api.test.ts
//
// Network-free contract tests for the same-origin WTR-Lab API clients in
// `src/retranslate/api.ts`. No live endpoints are ever hit: every test injects
// a fake `fetch` that records the request URL/init and returns canned JSON.
//
// The observed WTR-Lab batch-info endpoint is the versioned path
//   `/api/v2/chapter/retranslate/batch-info?raw_id=...&start_order=...`
// and `fetchBatchInfo` now implements that contract directly.

import {
	fetchBatchInfo,
	fetchReaderGet,
	parseBatchInfoResponse,
} from "../../src/retranslate/api";

/** A single recorded fake-fetch invocation. */
interface FetchCall {
	url: string;
	init?: RequestInit;
}

/**
 * Builds an injected fake `fetch` that records every call and resolves with a
 * canned JSON body. No network I/O occurs. Returns the recorder + the fetch
 * implementation to pass into the API clients.
 */
function fakeFetch(
	responseBody: unknown,
	{ ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
	const calls: FetchCall[] = [];
	const impl = jest.fn(async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		return { ok, status, json: async () => responseBody } as unknown as Response;
	});
	return { fetchImpl: impl as unknown as typeof fetch, calls };
}

/** Parses a (possibly relative) URL string into pathname + search params. */
function parseUrl(rawUrl: string): { pathname: string; searchParams: URLSearchParams } {
	const parsed = new URL(rawUrl, "https://wtr-lab.com/");
	return { pathname: parsed.pathname, searchParams: parsed.searchParams };
}

describe("fetchBatchInfo — observed WTR-Lab endpoint contract", () => {
	it("calls the versioned /api/v2/chapter/retranslate/batch-info path", async () => {
		const { fetchImpl, calls } = fakeFetch({ ticket_balance: 0 });

		await fetchBatchInfo({ rawId: 999, startOrder: 7 }, fetchImpl);

		expect(calls).toHaveLength(1);
		const { pathname } = parseUrl(calls[0].url);
		expect(pathname).toBe("/api/v2/chapter/retranslate/batch-info");
	});

	it("sends raw_id and start_order query parameters", async () => {
		const { fetchImpl, calls } = fakeFetch({ ticket_balance: 0 });

		await fetchBatchInfo({ rawId: 999, startOrder: 7 }, fetchImpl);

		const { searchParams } = parseUrl(calls[0].url);
		expect(searchParams.get("raw_id")).toBe("999");
		expect(searchParams.get("start_order")).toBe("7");
	});

	it("does not send the legacy novel_id parameter", async () => {
		const { fetchImpl, calls } = fakeFetch({ ticket_balance: 0 });

		await fetchBatchInfo({ rawId: 999, startOrder: 7 }, fetchImpl);

		const { searchParams } = parseUrl(calls[0].url);
		expect(searchParams.get("novel_id")).toBeNull();
	});

	it("uses GET with same-origin credentials (safety guardrail)", async () => {
		const { fetchImpl, calls } = fakeFetch({ ticket_balance: 0 });

		await fetchBatchInfo({ rawId: 999, startOrder: 7 }, fetchImpl);

		expect(calls[0].init?.method).toBe("GET");
		expect(calls[0].init?.credentials).toBe("same-origin");
	});

	it("returns the parsed response JSON for the caller to consume", async () => {
		const body = { ticket_balance: 42 };
		const { fetchImpl } = fakeFetch(body);

		const result = await fetchBatchInfo({ rawId: 1, startOrder: 1 }, fetchImpl);

		expect(result).toEqual(body);
	});

	it("throws when the batch-info response is not ok", async () => {
		const { fetchImpl } = fakeFetch({}, { ok: false, status: 500 });

		await expect(
			fetchBatchInfo({ rawId: 1, startOrder: 1 }, fetchImpl),
		).rejects.toThrow(/batch-info failed: 500/);
	});
});

describe("fetchReaderGet — reader endpoint contract (regression guard)", () => {
	it("calls /api/reader/get with novel_id and chapter_ids[] using GET + same-origin", async () => {
		const { fetchImpl, calls } = fakeFetch({ data: [] });

		await fetchReaderGet({ novelId: 42, chapterIds: [1, 2, 3] }, fetchImpl);

		expect(calls).toHaveLength(1);
		const { pathname, searchParams } = parseUrl(calls[0].url);
		expect(pathname).toBe("/api/reader/get");
		expect(searchParams.get("novel_id")).toBe("42");
		expect(searchParams.getAll("chapter_ids[]")).toEqual(["1", "2", "3"]);
		expect(calls[0].init?.method).toBe("GET");
		expect(calls[0].init?.credentials).toBe("same-origin");
	});
});

describe("parseBatchInfoResponse — field-alias contract (regression guard)", () => {
	it("extracts the ticket balance from ticket_balance (and the balance alias)", () => {
		expect(parseBatchInfoResponse({ ticket_balance: 5 }).ticketBalance).toBe(5);
		expect(parseBatchInfoResponse({ balance: 12.5 }).ticketBalance).toBe(12.5);
	});

	it("extracts per-model free_quota and unit_cost from the models array", () => {
		const result = parseBatchInfoResponse({
			ticket_balance: 100,
			models: [
				{ ai_id: "gpt-4o", free_quota: 3, unit_cost: 1.5 },
				{ ai_id: "gemini-3.0-flash", free_quota: 0, unit_cost: 2.25 },
			],
		});

		expect(result.freeQuotaByAiId.get("gpt-4o")).toBe(3);
		expect(result.unitCostByAiId.get("gpt-4o")).toBe(1.5);
		expect(result.freeQuotaByAiId.get("gemini-3.0-flash")).toBe(0);
		expect(result.unitCostByAiId.get("gemini-3.0-flash")).toBe(2.25);
	});

	it("accepts the model_list / quota / cost / id aliases", () => {
		const result = parseBatchInfoResponse({
			model_list: [{ id: "m1", quota: 7, cost: 4 }],
		});

		expect(result.freeQuotaByAiId.get("m1")).toBe(7);
		expect(result.unitCostByAiId.get("m1")).toBe(4);
	});

	it("defaults missing optional model fields to zero", () => {
		const result = parseBatchInfoResponse({ models: [{ ai_id: "m" }] });

		expect(result.freeQuotaByAiId.get("m")).toBe(0);
		expect(result.unitCostByAiId.get("m")).toBe(0);
		expect(result.ticketBalance).toBe(0);
	});

	it("returns zero balance and empty maps for non-object payloads (defensive)", () => {
		expect(parseBatchInfoResponse(null).ticketBalance).toBe(0);
		expect(parseBatchInfoResponse("nope").freeQuotaByAiId.size).toBe(0);
		expect(parseBatchInfoResponse(42).unitCostByAiId.size).toBe(0);
		expect(parseBatchInfoResponse(undefined).ticketBalance).toBe(0);
	});
});
