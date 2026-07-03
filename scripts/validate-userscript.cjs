#!/usr/bin/env node
// scripts/validate-userscript.cjs
// Validates generated userscript artifacts for WTR Lab Retranslate.

const fs = require("node:fs")
const path = require("node:path")
const { getVersion } = require("../config/versions.cjs")
const { PACKAGE_NAME, SCRIPT_NAME } = require("../userscript.metadata.cjs")

const DIST_DIR = path.join(__dirname, "..", "dist")
const EXPECTED_ARTIFACTS = [
	`${PACKAGE_NAME}.user.js`,
	`${PACKAGE_NAME}.meta.js`,
	`${PACKAGE_NAME}.greasyfork.user.js`,
	`${PACKAGE_NAME}.greasyfork.meta.js`,
	`${PACKAGE_NAME}.dev.user.js`,
	`${PACKAGE_NAME}.dev.meta.js`,
	`${PACKAGE_NAME}.dev.proxy.user.js`,
]

const REQUIRED_HEADER_FIELDS = [
	"@name",
	"@description",
	"@version",
	"@author",
	"@supportURL",
	"@match",
	"@grant GM_setValue",
	"@grant GM_getValue",
	"@grant GM_registerMenuCommand",
	"@icon",
	"@license",
	"@namespace",
	"@run-at document-idle",
	"@website",
]

const HEADER_START = "// ==UserScript=="
const HEADER_END = "// ==/UserScript=="

function fail(message) {
	throw new Error(message)
}

function readArtifact(fileName) {
	const filePath = path.join(DIST_DIR, fileName)
	if (!fs.existsSync(filePath)) {
		fail(`Missing expected dist artifact: dist/${fileName}`)
	}

	return fs.readFileSync(filePath, "utf8")
}

function getMetadataHeader(script, fileName) {
	if (!script.startsWith(HEADER_START)) {
		fail(`dist/${fileName} does not start with a userscript metadata header.`)
	}

	const headerEndIndex = script.indexOf(HEADER_END)
	if (headerEndIndex === -1) {
		fail(`dist/${fileName} is missing the metadata header terminator.`)
	}

	return script.slice(0, headerEndIndex + HEADER_END.length)
}

function getHeaderValue(header, fieldName) {
	const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	return header.match(new RegExp(`^//\\s+${escapedField}\\s+(.+)$`, "m"))?.[1]
}

function validateRequiredFields(header, fileName, { requiresDownloadUrls }) {
	for (const field of REQUIRED_HEADER_FIELDS) {
		if (!header.includes(field)) {
			fail(`dist/${fileName} is missing required metadata field: ${field}`)
		}
	}

	for (const field of ["@downloadURL", "@updateURL"]) {
		const hasField = header.includes(field)
		if (requiresDownloadUrls && !hasField) {
			fail(`dist/${fileName} is missing required metadata field: ${field}`)
		}
		if (!requiresDownloadUrls && hasField) {
			fail(`dist/${fileName} unexpectedly includes ${field}.`)
		}
	}

	// Same-origin only: the script must never declare a @connect grant.
	if (header.includes("@connect")) {
		fail(`dist/${fileName} unexpectedly includes @connect; the script is same-origin only.`)
	}
}

function validateMetadataValues(header, fileName, { expectedName, expectedVersion, requiresDownloadUrls }) {
	const name = getHeaderValue(header, "@name")
	if (name !== expectedName) {
		fail(`dist/${fileName} has invalid @name value: ${name ?? "missing"}`)
	}

	const version = getHeaderValue(header, "@version")
	if (!version || !expectedVersion.test(version)) {
		fail(`dist/${fileName} has invalid @version value: ${version ?? "missing"}`)
	}

	const namespace = getHeaderValue(header, "@namespace")
	if (namespace !== "https://github.com/MasuRii/wtr-lab-retranslate") {
		fail(`dist/${fileName} has invalid @namespace value: ${namespace ?? "missing"}`)
	}

	const match = getHeaderValue(header, "@match")
	if (match !== "https://wtr-lab.com/en/novel/*/*/*") {
		fail(`dist/${fileName} has invalid @match value: ${match ?? "missing"}`)
	}

	if (requiresDownloadUrls) {
		const expectedDownloadUrl = `https://raw.githubusercontent.com/MasuRii/wtr-lab-retranslate/main/dist/${PACKAGE_NAME}.user.js`
		const expectedUpdateUrl = `https://raw.githubusercontent.com/MasuRii/wtr-lab-retranslate/main/dist/${PACKAGE_NAME}.meta.js`
		const downloadUrl = getHeaderValue(header, "@downloadURL")
		if (downloadUrl !== expectedDownloadUrl) {
			fail(`dist/${fileName} has invalid @downloadURL value: ${downloadUrl ?? "missing"}`)
		}
		const updateUrl = getHeaderValue(header, "@updateURL")
		if (updateUrl !== expectedUpdateUrl) {
			fail(`dist/${fileName} has invalid @updateURL value: ${updateUrl ?? "missing"}`)
		}
	}
}

function validateUserScript(fileName, options) {
	const script = readArtifact(fileName)
	const header = getMetadataHeader(script, fileName)
	validateRequiredFields(header, fileName, options)
	validateMetadataValues(header, fileName, options)
	return header
}

function validateMetaFile(metaFileName, userFileName) {
	const meta = readArtifact(metaFileName).trim()
	const scriptHeader = getMetadataHeader(readArtifact(userFileName), userFileName).trim()

	if (meta !== scriptHeader) {
		fail(`dist/${metaFileName} does not match the metadata header from dist/${userFileName}.`)
	}
}

const semanticVersion = getVersion("semantic").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
validateUserScript(`${PACKAGE_NAME}.user.js`, {
	expectedName: SCRIPT_NAME,
	expectedVersion: new RegExp(`^${semanticVersion}$`),
	requiresDownloadUrls: true,
})
validateMetaFile(`${PACKAGE_NAME}.meta.js`, `${PACKAGE_NAME}.user.js`)

validateUserScript(`${PACKAGE_NAME}.greasyfork.user.js`, {
	expectedName: SCRIPT_NAME,
	expectedVersion: new RegExp(`^${semanticVersion}$`),
	requiresDownloadUrls: false,
})
validateMetaFile(`${PACKAGE_NAME}.greasyfork.meta.js`, `${PACKAGE_NAME}.greasyfork.user.js`)

validateUserScript(`${PACKAGE_NAME}.dev.user.js`, {
	expectedName: `${SCRIPT_NAME} [DEV]`,
	expectedVersion: new RegExp(`^${semanticVersion}-dev\\.\\d+$`),
	requiresDownloadUrls: false,
})
validateMetaFile(`${PACKAGE_NAME}.dev.meta.js`, `${PACKAGE_NAME}.dev.user.js`)
readArtifact(`${PACKAGE_NAME}.dev.proxy.user.js`)

console.log(`Validated ${EXPECTED_ARTIFACTS.length} dist artifacts for ${PACKAGE_NAME}.`)
