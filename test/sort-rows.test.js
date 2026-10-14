"use strict";

/*
 * Tests sorting a table by a column from the header menu: the config rows stay at the top
 * (type row first), the data rows are ordered by the column's type, empty cells go last in
 * both directions, and the header menu's sort action rewrites only the table body.
 * Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

class RangeSetBuilder {
	constructor() { this.added = []; }
	add(from, to, deco) { this.added.push({ from, to, deco }); }
	finish() { return this.added; }
}
const Decoration = { none: "none", replace: (spec) => spec };
const plugin = loadPlugin({ RangeSetBuilder, Decoration });
const { findSmartTables, sortTableRows, buildSmartTableDecorations } = plugin;

// The __ format after an earlier sort: the type row and an option row are among the data.
const TABLE = [
	"| Task  | Status   | Due        | Amount     | Done |", // 0
	"| ----  | ------   | ---        | ------     | ---- |", // 1
	"| Ship  | Done     | 2026-10-20 | 30         | [x]  |", // 2
	"| -     | __Todo   | -          | __EUR      | -    |", // 3 option row
	"| alpha | Todo     |            | 4.5        | [ ]  |", // 4
	"| __text | __select | __date    | __currency | __   |", // 5 type row
	"| -     | __Doing  | -          | -          | -    |", // 6 option row
	"| -     | __Done   | -          | -          | -    |", // 7 option row
	"| Beta  | Doing    | 2026-10-13 | 100        | [ ]  |", // 8
	"| item10 | Other   | 2026-09-01 |            | [x]  |", // 9
	"| item9 | Todo     | 2026-11-01 | 12         | [x]  |", // 10
];

const tableOf = (lines) => findSmartTables(lines.join("\n"))[0];
const firstCells = (rows) => rows.map((r) => r.split("|")[1].trim());
const sortBy = (col, descending) => Array.from(sortTableRows(TABLE, tableOf(TABLE), col, descending));

test("config rows move to the top, type row first, option rows in their order", () => {
	const rows = sortBy(0, false);
	assert.deepStrictEqual(rows.slice(0, 4), [TABLE[5], TABLE[3], TABLE[6], TABLE[7]]);
	assert.strictEqual(rows.length, TABLE.length - 2);
});

test("text sorts case-insensitively with numbers in natural order", () => {
	assert.deepStrictEqual(firstCells(sortBy(0, false).slice(4)), ["alpha", "Beta", "item9", "item10", "Ship"]);
	assert.deepStrictEqual(firstCells(sortBy(0, true).slice(4)), ["Ship", "item10", "item9", "Beta", "alpha"]);
});

test("select sorts in option order, values without an option after them", () => {
	assert.deepStrictEqual(firstCells(sortBy(1, false).slice(4)), ["alpha", "item9", "Beta", "Ship", "item10"]);
	assert.deepStrictEqual(firstCells(sortBy(1, true).slice(4)), ["item10", "Ship", "Beta", "alpha", "item9"]);
});

test("dates sort chronologically and empty cells go last in both directions", () => {
	assert.deepStrictEqual(firstCells(sortBy(2, false).slice(4)), ["item10", "Beta", "Ship", "item9", "alpha"]);
	assert.deepStrictEqual(firstCells(sortBy(2, true).slice(4)), ["item9", "Ship", "Beta", "item10", "alpha"]);
});

test("currency sorts by number, not by text", () => {
	assert.deepStrictEqual(firstCells(sortBy(3, false).slice(4)), ["alpha", "item9", "Ship", "Beta", "item10"]);
});

test("boxes sort unchecked first, equal values keep their order", () => {
	assert.deepStrictEqual(firstCells(sortBy(4, false).slice(4)), ["alpha", "Beta", "Ship", "item10", "item9"]);
	assert.deepStrictEqual(firstCells(sortBy(4, true).slice(4)), ["Ship", "item10", "item9", "alpha", "Beta"]);
});

test("percentages sort by number", () => {
	const lines = ["| P |", "| - |", "| __percentage |", "| 100% |", "| 9% |", "| 60% |"];
	assert.deepStrictEqual(Array.from(sortTableRows(lines, tableOf(lines), 0, false)), ["| __percentage |", "| 9% |", "| 60% |", "| 100% |"]);
});

test("the older positional format keeps its type block, end row included, at the top", () => {
	const lines = ["| A | B |", "| - | - |", "| text | select |", "| | x |", "| === | === |", "| b | x |", "| a | x |"];
	assert.deepStrictEqual(Array.from(sortTableRows(lines, tableOf(lines), 0, false)), lines.slice(2, 5).concat(["| a | x |", "| b | x |"]));
});

test("a comment-format table sorts all body rows", () => {
	const lines = ["<!-- table-fields id=\"t\" v=\"1\"", "cols:", "  - {name: \"N\", type: \"currency\"}", "-->", "", "| N |", "| - |", "| 20 |", "| 3 |"];
	const t = findSmartTables(lines.join("\n"))[0];
	assert.deepStrictEqual(Array.from(sortTableRows(lines, t, 0, false)),["| 3 |", "| 20 |"]);
});

// Minimal EditorState over `doc`: Live Preview on, cursor at the end.
function fakeState(doc) {
	const lines = doc.split("\n");
	const starts = [];
	let pos = 0;
	for (const l of lines) { starts.push(pos); pos += l.length + 1; }
	return {
		field: () => true,
		doc: {
			toString: () => doc,
			line: (n) => ({ from: starts[n - 1], to: starts[n - 1] + lines[n - 1].length, text: lines[n - 1] }),
			sliceString: (from, to) => doc.slice(from, to),
		},
		selection: { main: { from: doc.length, to: doc.length } },
	};
}

// Minimal EditorView over `doc` that applies the dispatched change.
function fakeView(doc) {
	const view = {
		doc,
		state: fakeState(doc),
		dispatched: 0,
		dispatch({ changes }) {
			view.dispatched++;
			view.doc = view.doc.slice(0, changes.from) + changes.insert + view.doc.slice(changes.to);
		},
	};
	return view;
}

// The Live Preview widget of the first smart table in `doc`.
const widgetOf = (doc) => buildSmartTableDecorations(fakeState(doc))[0].deco.widget;

test("the menu's sort rewrites only the table body and leaves text around it", () => {
	const doc = ["Intro", "", ...TABLE, "", "after"].join("\n");
	const view = fakeView(doc);
	widgetOf(doc).sortRows(view, 0, false);
	const out = view.doc.split("\n");
	assert.deepStrictEqual(out.slice(0, 4), ["Intro", "", TABLE[0], TABLE[1]]);
	assert.deepStrictEqual(out.slice(4, TABLE.length + 2), sortBy(0, false));
	assert.deepStrictEqual(out.slice(-2), ["", "after"]);
});

test("sorting an already sorted table changes nothing", () => {
	const doc = ["| A |", "| - |", "| __text |", "| a |", "| b |", "", "after"].join("\n");
	const view = fakeView(doc);
	widgetOf(doc).sortRows(view, 0, false);
	assert.strictEqual(view.dispatched, 0);
});
