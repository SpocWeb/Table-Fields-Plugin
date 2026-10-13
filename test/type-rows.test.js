"use strict";

/*
 * Tests the table-internal config format: a type row after the header's delimiter,
 * option rows (one option per row and column), then a row of === before the data.
 * Covers parsing, precedence over a config comment, fenced code blocks, the Live Preview
 * widget data, and Reading view hiding the config rows. Run: npm test
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
const { findSmartTables, parseTypeRows, isDelimiterRow, buildSmartTableDecorations } = plugin;

const TABLE = [
	"| Task | Status | Due  | Amount   | Done     |", // 0
	"| ---- | :----: | ---- | -------- | -------- |", // 1
	"| text | select | date | currency | checkbox |", // 2
	"|      | Todo   |      | EUR      |          |", // 3
	"|      | Doing  |      |          |          |", // 4
	"|      | a\\|b  |      |          |          |", // 5
	"| ===  | ===    | ===  | ===      | ===      |", // 6
	"| PRD  | Doing  | 2026-10-13 | 12 | [x]      |", // 7
	"| Ship | Todo   | 2026-10-20 | 30 | [ ]      |", // 8
];

const plain = (cols) => Array.from(cols, (c) => ({ name: c.name, type: c.type, options: Array.from(c.options) }));

test("delimiter rows are recognized, with or without alignment colons", () => {
	assert.ok(isDelimiterRow("| --- | :-: | --: |"));
	assert.ok(isDelimiterRow("---|---"));
	assert.ok(!isDelimiterRow("| text | --- |"));
	assert.ok(!isDelimiterRow(""));
	assert.ok(!isDelimiterRow(undefined));
});

test("type row and option rows become the column config", () => {
	const parsed = parseTypeRows(TABLE, 0, TABLE.length - 1);
	assert.strictEqual(parsed.typeLine, 2);
	assert.deepStrictEqual(Array.from(parsed.configLines), [2, 3, 4, 5, 6]);
	assert.strictEqual(parsed.marked, false);
	assert.deepStrictEqual(plain(parsed.config.cols), [
		{ name: "Task", type: "text", options: [] },
		{ name: "Status", type: "select", options: ["Todo", "Doing", "a|b"] },
		{ name: "Due", type: "date", options: [] },
		{ name: "Amount", type: "currency", options: ["EUR"] },
		{ name: "Done", type: "checkbox", options: [] },
	]);
});

test("empty type cells mean text, type names are case-insensitive", () => {
	const lines = ["| A | B |", "| - | - |", "|   | Checkbox |", "| - | - |", "| x | [ ] |"];
	assert.deepStrictEqual(Array.from(parseTypeRows(lines, 0, 4).config.cols, (c) => c.type), ["text", "checkbox"]);
});

test("box is the short name of checkbox, in type rows and in comments", () => {
	const rows = ["| A | B | C |", "| - | - | - |", "| box | Box | checkbox |", "| - | - | - |", "| [x] | [ ] | [ ] |"];
	assert.deepStrictEqual(Array.from(parseTypeRows(rows, 0, 4).config.cols, (c) => c.type), ["checkbox", "checkbox", "checkbox"]);
	const doc = ["<!-- table-fields id=\"t\" v=\"1\"", "cols:", "  - {name: \"Done\", type: \"box\"}", "-->", "", "| Done |", "| ---- |", "| [x]  |"].join("\n");
	assert.strictEqual(findSmartTables(doc)[0].config.cols[0].type, "checkbox");
});

test("an ordinary first data row is not mistaken for a type row", () => {
	const lines = ["| A | B |", "| - | - |", "| hello | date |", "| - | - |"];
	assert.strictEqual(parseTypeRows(lines, 0, 3), null);
});

test("an older second --- row still closes the type section", () => {
	const lines = ["| A | B |", "| - | - |", "| text | box |", "|  | x |", "| - | - |", "| a | [ ] |"];
	const parsed = parseTypeRows(lines, 0, 5);
	assert.deepStrictEqual(Array.from(parsed.configLines), [2, 3, 4]);
	assert.deepStrictEqual(Array.from(parsed.config.cols[1].options), ["x"]);
});

test("a type row without a closing row is not a type section", () => {
	const lines = ["| A | B |", "| - | - |", "| text | date |", "| x | 2026-10-13 |"];
	assert.strictEqual(parseTypeRows(lines, 0, 3), null);
});

test("an all-empty first row is not a type row", () => {
	const lines = ["| A | B |", "| - | - |", "|   |   |", "| - | - |"];
	assert.strictEqual(parseTypeRows(lines, 0, 3), null);
});

test("findSmartTables reports where data rows start", () => {
	const tables = findSmartTables(["Intro", "", ...TABLE, "", "after"].join("\n"));
	assert.strictEqual(tables.length, 1);
	assert.strictEqual(tables[0].headerLine, 2);
	assert.strictEqual(tables[0].typeLine, 4);
	assert.deepStrictEqual(Array.from(tables[0].configLines), [4, 5, 6, 7, 8]);
	assert.strictEqual(tables[0].lastRowLine, 10);
	assert.strictEqual(tables[0].comment, null);
});

test("type rows win over a config comment above the same table", () => {
	const doc = ["<!-- table-fields id=\"t\" v=\"1\"", "cols:", "  - {name: \"Task\", type: \"date\"}", "-->", "", ...TABLE].join("\n");
	const [t] = findSmartTables(doc);
	assert.strictEqual(t.config.cols[0].type, "text");
	assert.strictEqual(t.config.cols.length, 5);
	assert.strictEqual(t.comment, null);
});

test("comment-format tables are still found", () => {
	const doc = ["<!-- table-fields id=\"t\" v=\"1\"", "cols:", "  - {name: \"Done\", type: \"checkbox\"}", "-->", "", "| Done |", "| ---- |", "| [x]  |"].join("\n");
	const [t] = findSmartTables(doc);
	assert.strictEqual(t.config.cols[0].type, "checkbox");
	assert.deepStrictEqual({ start: t.comment.start, end: t.comment.end }, { start: 0, end: 3 });
	assert.deepStrictEqual(Array.from(t.configLines), []);
	assert.strictEqual(t.typeLine, null);
});

test("tables inside fenced code blocks are ignored", () => {
	for (const fence of ["```", "~~~~"]) {
		const doc = ["Example:", fence + "markdown", ...TABLE, fence, "", ...TABLE].join("\n");
		const tables = findSmartTables(doc);
		assert.strictEqual(tables.length, 1, fence);
		assert.strictEqual(tables[0].headerLine, TABLE.length + 4, fence);
	}
});

test("plain tables without types are not smart tables", () => {
	assert.strictEqual(findSmartTables("| A | B |\n| - | - |\n| 1 | 2 |").length, 0);
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
		},
		selection: { main: { from: doc.length, to: doc.length } },
	};
}

test("Live Preview widget covers the whole table and shows only data rows", () => {
	const doc = [...TABLE, "", "after"].join("\n");
	const state = fakeState(doc);
	const [deco] = buildSmartTableDecorations(state);
	assert.strictEqual(deco.from, 0);
	assert.strictEqual(deco.to, state.doc.line(9).to);
	const data = deco.deco.widget.data;
	assert.strictEqual(data.rows.length, 2);
	assert.strictEqual(data.rows[0].cells[0].text.trim(), "PRD");
	assert.strictEqual(data.configRange, null);
});

test("Live Preview widget knows the type cells, so a type change rewrites the type row", () => {
	const doc = [...TABLE, "", "after"].join("\n");
	const [deco] = buildSmartTableDecorations(fakeState(doc));
	const { typeCells } = deco.deco.widget.data;
	assert.strictEqual(typeCells.length, 5);
	assert.strictEqual(doc.slice(typeCells[1].from, typeCells[1].to).trim(), "select");
});

test("editing an option row changes the widget signature", () => {
	const signature = (lines) =>
		buildSmartTableDecorations(fakeState([...lines, "", "after"].join("\n")))[0].deco.widget.data.signature;
	const before = signature(TABLE);
	const edited = TABLE.slice();
	edited[3] = edited[3].replace("Todo", "Open");
	const after = signature(edited);
	assert.notStrictEqual(before, after);
});

// Reading view: fake rendered <table> whose tbody has one <tr> per source line after the
// delimiter (Obsidian renders type, option and === rows as ordinary rows).
function fakeRenderedTable(bodyLineCount) {
	const rows = [];
	for (let i = 0; i < bodyLineCount; i++) {
		const classes = new Set();
		rows.push({ classes, classList: { add: (c) => classes.add(c) }, children: [{ tagName: "TD" }, { tagName: "TD" }] });
	}
	const tableClasses = new Set();
	const table = { classList: { add: (c) => tableClasses.add(c) }, querySelectorAll: () => rows };
	return { table, rows };
}

test("Reading view hides the config rows and keeps row indexes on source lines", () => {
	const doc = ["Intro", "", ...TABLE].join("\n");
	const { table, rows } = fakeRenderedTable(TABLE.length - 2);
	const el = { findAll: () => [table] };
	const ctx = { getSectionInfo: () => ({ text: doc, lineStart: 2 }) };
	const enhanced = [];
	const self = { enhanceCell: (td, col, rowIndex, colIndex) => enhanced.push({ rowIndex, colIndex, type: col.type }) };
	plugin.module.exports.prototype.enhanceTables.call(self, el, ctx);

	const hidden = rows.map((r) => r.classes.has("tf-config-row"));
	assert.deepStrictEqual(hidden, [true, true, true, true, true, false, false]);
	// Data rows keep their tbody index: lineStart + 2 + rowIndex is their source line.
	assert.deepStrictEqual([...new Set(enhanced.map((e) => e.rowIndex))], [5, 6]);
	assert.strictEqual(doc.split("\n")[2 + 2 + 5].includes("PRD"), true);
});

// The __ format after sorting by a column: config rows scattered among the data rows.
const SORTED = [
	"| Task   | Status   | Done  |", // 0
	"| ----   | ------   | ----  |", // 1
	"| PRD    | Doing    | [x]   |", // 2
	"|        | __Done   |       |", // 3 option row
	"| Ship   | Todo     | [ ]   |", // 4
	"|        | __Todo   |       |", // 5 option row
	"| __text | __select | __box |", // 6 type row, sorted below its options
	"| Note   | __wow    | [ ]   |", // 7 data: a non-empty cell without __
	"|        |          |       |", // 8 data: no __ cell at all
];

test("config rows (only __ or empty cells) are found anywhere in the table", () => {
	const parsed = parseTypeRows(SORTED, 0, SORTED.length - 1);
	assert.strictEqual(parsed.marked, true);
	assert.strictEqual(parsed.typeLine, 6);
	assert.deepStrictEqual(Array.from(parsed.configLines), [3, 5, 6]);
	assert.deepStrictEqual(plain(parsed.config.cols), [
		{ name: "Task", type: "text", options: [] },
		{ name: "Status", type: "select", options: ["Done", "Todo"] },
		{ name: "Done", type: "checkbox", options: [] },
	]);
});

test("an empty type cell means text in the __ format", () => {
	const lines = ["| A | B |", "| - | - |", "|  | __box |", "| x | [ ] |"];
	assert.deepStrictEqual(Array.from(parseTypeRows(lines, 0, 3).config.cols, (c) => c.type), ["text", "checkbox"]);
});

test("a lone __ in the type row is the shortcut for box", () => {
	const lines = ["| A | B | C |", "| - | - | - |", "| __text | __ | __checkbox |", "| x | [ ] | [x] |"];
	assert.deepStrictEqual(Array.from(parseTypeRows(lines, 0, 3).config.cols, (c) => c.type), ["text", "checkbox", "checkbox"]);
});

test("Live Preview shows the data rows of a sorted table and writes types with the __ prefix", () => {
	const doc = [...SORTED, "", "after"].join("\n");
	const [deco] = buildSmartTableDecorations(fakeState(doc));
	const data = deco.deco.widget.data;
	assert.deepStrictEqual(Array.from(data.rows, (r) => r.cells[0].text.trim()), ["PRD", "Ship", "Note", ""]);
	assert.strictEqual(data.typeMark, "__");
	assert.strictEqual(doc.slice(data.typeCells[2].from, data.typeCells[2].to).trim(), "__box");
});

test("Reading view hides scattered config rows only", () => {
	const doc = SORTED.join("\n");
	const { table, rows } = fakeRenderedTable(SORTED.length - 2);
	const enhanced = [];
	plugin.module.exports.prototype.enhanceTables.call(
		{ enhanceCell: (td, col, rowIndex) => enhanced.push(rowIndex) },
		{ findAll: () => [table] },
		{ getSectionInfo: () => ({ text: doc, lineStart: 0 }) }
	);
	assert.deepStrictEqual(rows.map((r) => r.classes.has("tf-config-row")), [false, true, false, true, true, false, false]);
	assert.deepStrictEqual([...new Set(enhanced)], [0, 2, 5, 6]);
});

test("Reading view leaves a comment-format table's rows visible", () => {
	const doc = ["<!-- table-fields id=\"t\" v=\"1\"", "cols:", "  - {name: \"Done\", type: \"checkbox\"}", "-->", "", "| Done |", "| ---- |", "| [x]  |"].join("\n");
	const { table, rows } = fakeRenderedTable(1);
	const enhanced = [];
	plugin.module.exports.prototype.enhanceTables.call(
		{ enhanceCell: (td, col, rowIndex) => enhanced.push(rowIndex) },
		{ findAll: () => [table] },
		{ getSectionInfo: () => ({ text: doc, lineStart: 5 }) }
	);
	assert.ok(!rows[0].classes.has("tf-config-row"));
	assert.deepStrictEqual(enhanced, [0]);
});
