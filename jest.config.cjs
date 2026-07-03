/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: "jsdom",
	testMatch: ["**/test/**/*.test.ts"],
	transform: {
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
	},
	moduleFileExtensions: ["ts", "js", "json"],
	collectCoverageFrom: ["src/retranslate/**/*.ts"],
};
