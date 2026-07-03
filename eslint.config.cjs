const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
	{
		ignores: ["dist/**", "node_modules/**", "coverage/**"],
	},
	{
		files: ["src/**/*.ts", "test/**/*.ts"],
		languageOptions: {
			ecmaVersion: 2021,
			sourceType: "module",
			parser: tseslint.parser,
		},
		plugins: {
			"@typescript-eslint": tseslint.plugin,
		},
		rules: {
			"no-debugger": "error",
			"no-dupe-else-if": "error",
			"no-duplicate-case": "error",
			"no-unreachable": "error",
			"no-var": "error",
			"@typescript-eslint/no-duplicate-enum-values": "error",
			"@typescript-eslint/no-extra-non-null-assertion": "error",
			"@typescript-eslint/no-misused-new": "error",
			"@typescript-eslint/no-unsafe-declaration-merging": "error",
		},
	},
);
