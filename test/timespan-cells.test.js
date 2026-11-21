"use strict";

/*
 * Tests the timespan type: h:mm:ss and ISO 8601 durations (PT3h) are read, shown as
 * [w-][d_]hh:mm:ss, sorted by length, inferred from data, and `duration` is an alias. Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

const { parseTimespan, formatTimespan, formatTimespanCell, inferType, fieldType, compareCellValues } = loadPlugin();

test("a clock reads as seconds, hours may exceed 24", () => {
	assert.strictEqual(parseTimespan("12:34:56"), 45296);
	assert.strictEqual(parseTimespan("0:00:30"), 30);
	assert.strictEqual(parseTimespan("30:00:00"), 108000);
	assert.strictEqual(parseTimespan("00:00:01.5"), 1.5);
});

test("ISO durations read in any case", () => {
	assert.strictEqual(parseTimespan("PT3h"), 10800);
	assert.strictEqual(parseTimespan("PT1H30M"), 5400);
	assert.strictEqual(parseTimespan("PT45S"), 45);
	assert.strictEqual(parseTimespan("P1DT12H"), 129600);
	assert.strictEqual(parseTimespan("P2W"), 1209600);
	assert.strictEqual(parseTimespan("PT0.5H"), 1800);
});

test("other shapes stay unparsed", () => {
	for (const raw of ["", "P", "PT", "P1DT", "1:2:3", "12:60:00", "3h", "P1Y", "P1M", "abc", "12:34", "-PT1H"]) {
		assert.strictEqual(parseTimespan(raw), null, raw);
	}
});

test("formatting shows weeks and days only when there are any", () => {
	assert.strictEqual(formatTimespan(10800), "03:00:00");
	assert.strictEqual(formatTimespan(45), "00:00:45");
	assert.strictEqual(formatTimespan(86400 + 30), "1d_00:00:30");
	assert.strictEqual(formatTimespan(2 * 604800 + 3 * 86400 + 4 * 3600 + 5 * 60 + 6), "2w-3d_04:05:06");
	assert.strictEqual(formatTimespan(604800), "1w-0d_00:00:00");
	assert.strictEqual(formatTimespan(1.6), "00:00:02");
});

test("both written forms of the same span display alike", () => {
	assert.strictEqual(formatTimespanCell("PT90M"), formatTimespanCell("1:30:00"));
	assert.strictEqual(formatTimespanCell("junk"), null);
});

test("data infers the timespan type, dates and plain numbers do not", () => {
	assert.strictEqual(inferType("PT3h"), "timespan");
	assert.strictEqual(inferType("12:34:56"), "timespan");
	assert.strictEqual(inferType("2026-11-11_08:32"), "date");
	assert.strictEqual(inferType("12"), "currency");
});

test("duration is an alias of timespan", () => {
	assert.strictEqual(fieldType("duration"), "timespan");
	assert.strictEqual(fieldType("Timespan"), "timespan");
});

test("sorting compares by length, across both forms", () => {
	const col = { type: "timespan" };
	const cells = ["PT2H", "0:30:00", "P1D", "PT90M"];
	cells.sort((a, b) => compareCellValues(a, b, col));
	assert.deepStrictEqual(cells, ["0:30:00", "PT90M", "PT2H", "P1D"]);
});
