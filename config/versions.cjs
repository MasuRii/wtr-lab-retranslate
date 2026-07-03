// config/versions.cjs
// Centralized version management for WTR Lab Retranslate

const pkg = require("../package.json")

// Environment variable overrides with fallbacks
const envVersion = process.env.WTR_VERSION || process.env.APP_VERSION
const buildEnv = process.env.WTR_BUILD_ENV || process.env.BUILD_ENV || process.env.NODE_ENV
const buildDate = process.env.WTR_BUILD_DATE || process.env.BUILD_DATE || new Date().toISOString().split("T")[0]

// Derive base version from package.json at runtime so only package.json is edited manually
const BASE_VERSION = pkg.version

const VERSION_INFO = {
	SEMANTIC: envVersion || BASE_VERSION,
	DISPLAY: `v${envVersion || BASE_VERSION}`,
	BUILD_ENV: buildEnv || "production",
	BUILD_DATE: buildDate,
	GREASYFORK: envVersion || BASE_VERSION,
	NPM: envVersion || BASE_VERSION,
	BADGE: envVersion || BASE_VERSION,
	CHANGELOG: envVersion || BASE_VERSION,
}

const getVersion = (type = "semantic") => {
	switch (type.toLowerCase()) {
		case "semantic":
		case "semver":
			return VERSION_INFO.SEMANTIC
		case "display":
			return VERSION_INFO.DISPLAY
		case "build":
			return `${VERSION_INFO.SEMANTIC}-${VERSION_INFO.BUILD_ENV}`
		case "dev":
			return `${VERSION_INFO.SEMANTIC}-dev.${Date.now()}`
		default:
			return VERSION_INFO.SEMANTIC
	}
}

const getBuildTime = () => new Date().toISOString()
const getBuildDate = () => VERSION_INFO.BUILD_DATE
const isProduction = () => VERSION_INFO.BUILD_ENV === "production"
const isDevelopment = () => VERSION_INFO.BUILD_ENV === "development"

module.exports = {
	VERSION_INFO,
	getVersion,
	getBuildTime,
	getBuildDate,
	isProduction,
	isDevelopment,
}
