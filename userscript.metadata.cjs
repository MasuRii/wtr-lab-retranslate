// userscript.metadata.cjs
// Canonical userscript metadata for WTR Lab Retranslate

const pkg = require("./package.json")
const { getVersion } = require("./config/versions.cjs")

const SCRIPT_NAME = "WTR Lab Retranslate"
const PACKAGE_NAME = pkg.name
const REPOSITORY_URL = "https://github.com/MasuRii/wtr-lab-retranslate"
const RAW_DIST_URL = "https://raw.githubusercontent.com/MasuRii/wtr-lab-retranslate/main/dist"

const COMMON_HEADERS = {
	description: pkg.description,
	author: pkg.author,
	license: pkg.license,
	namespace: REPOSITORY_URL,
	match: "https://wtr-lab.com/en/novel/*/*/*",
	icon: "https://www.google.com/s2/favicons?sz=64&domain=wtr-lab.com",
	grant: ["GM_setValue", "GM_getValue", "GM_registerMenuCommand"],
	"run-at": "document-idle",
	supportURL: `${REPOSITORY_URL}/issues`,
	website: REPOSITORY_URL,
}

function getPerformanceHeaders() {
	return {
		...COMMON_HEADERS,
		name: SCRIPT_NAME,
		version: getVersion("semantic"),
		downloadURL: `${RAW_DIST_URL}/${PACKAGE_NAME}.user.js`,
		updateURL: `${RAW_DIST_URL}/${PACKAGE_NAME}.meta.js`,
	}
}

function getGreasyForkHeaders() {
	return {
		...COMMON_HEADERS,
		name: SCRIPT_NAME,
		version: getVersion("semantic"),
		// No updateURL/downloadURL for GreasyFork compliance.
	}
}

function getDevHeaders() {
	return {
		...COMMON_HEADERS,
		name: `${SCRIPT_NAME} [DEV]`,
		version: getVersion("dev"),
	}
}

module.exports = {
	COMMON_HEADERS,
	PACKAGE_NAME,
	SCRIPT_NAME,
	REPOSITORY_URL,
	RAW_DIST_URL,
	getPerformanceHeaders,
	getGreasyForkHeaders,
	getDevHeaders,
}
