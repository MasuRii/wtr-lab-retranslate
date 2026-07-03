// test/retranslate/domIntegration.test.ts
import { integrateRetranslateIntoDom } from "../../src/retranslate/domIntegration";
import type { RetranslateCandidate } from "../../src/retranslate/types";

function candidate(chapterId: number, ai_id: string): RetranslateCandidate {
	return { chapterId, chapterNo: chapterId, ai_id };
}

/**
 * Mirrors the existing WTR-Lab Batch Re-Translate drawer DOM (see DomSelectors.md).
 * The script MUST integrate into these existing selectors and never fabricate
 * its own modal/dialog/overlay.
 */
function buildModelList(): HTMLElement {
	const container = document.createElement("div");
	container.innerHTML = `
<div class="brt-model-list">
  <div class="brt-model-row is-selected">
    <div class="brt-model-check checked"><span>✓</span></div>
    <span class="brt-model-name">gemini-3.0-flash</span>
    <span class="brt-model-count">1 ch.</span>
  </div>
  <div class="brt-model-row is-selected">
    <div class="brt-model-check checked"><span>✓</span></div>
    <span class="brt-model-name">gemini-3.1-flash-lite</span>
    <span class="brt-model-count">2 ch.</span>
  </div>
</div>`.trim();
	return container;
}

function findRowByName(modelList: HTMLElement, name: string): HTMLElement | null {
	const rows = Array.from(modelList.querySelectorAll<HTMLElement>(".brt-model-row"));
	return rows.find((row) => row.querySelector(".brt-model-name")?.textContent === name) ?? null;
}

/** Selector list for any custom script modal/dialog/overlay — none may ever exist. */
const OVERLAY_SELECTORS = [
	".wtr-retranslate-modal",
	".wtr-retranslate-dialog",
	".wtr-retranslate-overlay",
	".wtr-retranslate-portal",
	"[data-retranslate-modal]",
	"[data-retranslate-overlay]",
].join(", ");

describe("integrateRetranslateIntoDom", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("annotates existing brt-model-row elements with per-ai_id candidate counts", () => {
		const modelList = buildModelList();
		document.body.appendChild(modelList);
		const candidatesByAiId = new Map<string, readonly RetranslateCandidate[]>([
			[
				"gemini-3.0-flash",
				[
					candidate(1, "gemini-3.0-flash"),
					candidate(2, "gemini-3.0-flash"),
					candidate(3, "gemini-3.0-flash"),
				],
			],
			["gemini-3.1-flash-lite", [candidate(4, "gemini-3.1-flash-lite")]],
		]);

		const result = integrateRetranslateIntoDom({ modelList, candidatesByAiId });

		const flashRow = findRowByName(modelList, "gemini-3.0-flash");
		const liteRow = findRowByName(modelList, "gemini-3.1-flash-lite");

		expect(result.annotatedRowCount).toBe(2);
		expect(flashRow?.querySelector(".brt-candidate-count")?.textContent).toContain("3");
		expect(liteRow?.querySelector(".brt-candidate-count")?.textContent).toContain("1");
	});

	it("does not create any custom modal, dialog, or overlay element", () => {
		const modelList = buildModelList();
		document.body.appendChild(modelList);
		const candidatesByAiId = new Map([["gemini-3.0-flash", [candidate(1, "gemini-3.0-flash")]]]);

		integrateRetranslateIntoDom({ modelList, candidatesByAiId });

		expect(document.querySelectorAll(OVERLAY_SELECTORS).length).toBe(0);
	});

	it("does not add a new dialog role and reports zero created dialogs/overlays", () => {
		const drawer = document.createElement("div");
		drawer.setAttribute("role", "dialog");
		drawer.setAttribute("data-slot", "drawer-popup");
		drawer.setAttribute("class", "batch-unlock-canvas");
		drawer.appendChild(buildModelList());
		document.body.appendChild(drawer);

		const dialogsBefore = document.querySelectorAll('[role="dialog"]').length;
		const candidatesByAiId = new Map([["gemini-3.0-flash", [candidate(1, "gemini-3.0-flash")]]]);

		const result = integrateRetranslateIntoDom({
			modelList: drawer.querySelector(".brt-model-list") as HTMLElement,
			candidatesByAiId,
		});

		expect(document.querySelectorAll('[role="dialog"]').length).toBe(dialogsBefore);
		expect(result.createdDialogCount).toBe(0);
		expect(result.createdOverlayCount).toBe(0);
	});
});
