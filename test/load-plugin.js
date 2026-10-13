"use strict";

/*
 * Loads main.js in a vm context with obsidian and @codemirror stubbed, so its
 * module-level helper functions can be called directly from tests.
 * `obsidian` overrides individual exports of the obsidian stub (e.g. MarkdownRenderer).
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadPlugin(obsidian = {}) {
	const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
	const stub = new Proxy({}, {
		get: (_, name) => (name in obsidian ? obsidian[name] : class { static define() { return {}; } static fromClass() { return {}; } }),
	});
	const ctx = { require: () => stub, module: { exports: {} }, console };
	vm.createContext(ctx);
	vm.runInContext(src, ctx);
	return ctx;
}

module.exports = { loadPlugin };
