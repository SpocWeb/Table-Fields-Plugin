"use strict";

/*
 * Tests that date cells accept a date with a time joined by `_` or `T`
 * (`2026-11-11_08:32`), render it in the locale and keep the raw value on hover. Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

const { formatDate, inferType } = loadPlugin();

test("a plain ISO date renders as the locale date", () => {
	assert.strictEqual(formatDate("2026-11-11"), new Date("2026-11-11T00:00:00").toLocaleDateString());
});

test("a date with `_` and a time renders date and time", () => {
	const d = new Date("2026-11-11T08:32");
	const expected = d.toLocaleDateString() + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	assert.strictEqual(formatDate("2026-11-11_08:32"), expected);
	assert.strictEqual(formatDate(" 2026-11-11T08:32:05 "), d.toLocaleDateString() + " "
		+ new Date("2026-11-11T08:32:05").toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
});

test("other shapes stay unparsed", () => {
	for (const raw of ["11-11 08:32", "2026-11-11 08:32", "2026-11-11_8:32", "2026-11-11_", "2026-13-45_08:32"]) {
		assert.strictEqual(formatDate(raw), null, raw);
	}
});

test("a date with a time infers the date type", () => {
	assert.strictEqual(inferType("2026-11-11_08:32"), "date");
	assert.strictEqual(inferType("2026-11-11"), "date");
	assert.strictEqual(inferType("11-11 08:32"), "text");
});
