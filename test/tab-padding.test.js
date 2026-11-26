"use strict";

/*
 * Tests the tabPadding option: when the plugin writes a Table Fields table, every row of it
 * (header, --- row, config and data rows, and a metadata table above) is written as
 * "| text<TAB>| ..." - one space left, one tab before each closing pipe. Tables the write does
 * not touch, plain tables and the option switched off leave the text as it is.
 * Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");
const { loadPlugin } = require("./load-plugin");

// EditorState.transactionFilter.of(f) returns f, so the filter can be called directly.
const EditorState = { transactionFilter: { of: (f) => f } };
const plugin = loadPlugin({ EditorState });
const { tabPadRow, tabPadTouchedTables, tabPaddingFilter } = plugin;
const setTabPadding = (on) => vm.runInContext("activeSettings.tabPadding = " + on, plugin);
const plain = (x) => JSON.parse(JSON.stringify(x));

const SMART = [
	"| Task  | Done |", // 0
	"| ----  | :--: |", // 1
	"| __text | __  |", // 2
	"| a     | [x]  |", // 3
];

test("a row gets one space left and one tab before every closing pipe", () => {
	assert.strictEqual(tabPadRow("|  Task   | Status |"), "| Task\t| Status\t|");
	assert.strictEqual(tabPadRow("| ----  | :--: |"), "| ----\t| :--:\t|");
});

test("an empty cell becomes one space and one tab", () => {
	assert.strictEqual(tabPadRow("| a |     ||"), "| a\t| \t| \t|");
});

test("escaped pipes, wikilink aliases and code pipes stay inside their cell", () => {
	assert.strictEqual(tabPadRow("| a \\| b   | [[x|y]]  | `p|q`  |"), "| a \\| b\t| [[x|y]]\t| `p|q`\t|");
});

test("indentation, a trailing \\r and a row without outer pipes are handled", () => {
	assert.strictEqual(tabPadRow("  | a  | b |\r"), "  | a\t| b\t|\r");
	assert.strictEqual(tabPadRow("a  | b  "), "a\t| b");
	assert.strictEqual(tabPadRow("no pipes here"), "no pipes here");
});

test("a padded row is unchanged by a second pass", () => {
	const once = tabPadRow("|  Task   | Status |");
	assert.strictEqual(tabPadRow(once), once);
});

test("a padded table still parses with the same types and delimiter row", () => {
	const padded = SMART.map((l) => tabPadRow(l));
	const t = plugin.findSmartTables(padded.join("\n"))[0];
	assert.ok(t, "still a smart table");
	assert.deepStrictEqual(Array.from(t.config.cols, (c) => [c.name, c.type]), [["Task", "text"], ["Done", "checkbox"]]);
});

test("a touched smart table is padded on every row, header and --- row included", () => {
	const { lines, changed } = tabPadTouchedTables(SMART, [[3, 3]]);
	assert.deepStrictEqual(plain(lines), ["| Task\t| Done\t|", "| ----\t| :--:\t|", "| __text\t| __\t|", "| a\t| [x]\t|"]);
	assert.deepStrictEqual(plain(changed), [0, 1, 2, 3]);
});

test("an untouched smart table, a plain table and fenced code stay as they are", () => {
	const doc = [...SMART, "", "| P | Q |", "|---|---|", "| 1 | 2 |", "", "```", ...SMART, "```"];
	const { lines, changed } = tabPadTouchedTables(doc, [[5, 7]]);
	assert.deepStrictEqual(plain(changed), []);
	assert.deepStrictEqual(plain(lines), doc);
	assert.deepStrictEqual(plain(tabPadTouchedTables(doc, [[10, 13]]).changed), []);
});

test("the metadata table above a touched table is padded too", () => {
	const doc = ["| Column | Type |", "|---|---|", "| A | date |", "", "| A  | B  |", "|----|----|", "| x  | y  |"];
	const { lines, changed } = tabPadTouchedTables(doc, [[6, 6]]);
	assert.deepStrictEqual(plain(changed), [0, 1, 2, 4, 5, 6]);
	assert.strictEqual(lines[0], "| Column\t| Type\t|");
	assert.strictEqual(lines[3], "");
	assert.strictEqual(lines[5], "| ----\t| ----\t|");
});

// Typed: Amount is currency, Share percentage. Untyped: Qty holds only numbers (and a - and an
// empty cell), Name text in a centered column, Code text that only partly looks like numbers.
const NUMBERS = [
	"| Name | Amount | Share | Qty | Code |", // 0
	"| :--: | --- | ---: | :-: | --- |", // 1
	"| __text | __currency | __percentage | | |", // 2
	"| -    | __EUR | - | - | - |", // 3
	"| ab   | 12.50 | 5% | 3 | 7 |", // 4
	"| cdef | 1200.00 | | - | x1 |", // 5
	"| g | | 60% | 1,5 | 9 |", // 6
];

test("number columns are right-aligned to their widest cell and keep the tab", () => {
	const { lines } = tabPadTouchedTables(NUMBERS, [[4, 4]]);
	assert.deepStrictEqual(plain(lines), [
		"| Name\t|     Amount\t|        Share\t|   Qty\t| Code\t|",
		"| :--:\t| ----------\t| -----------:\t| :---:\t| ---\t|",
		"| __text\t| __currency\t| __percentage\t| \t| \t|",
		"| -\t|      __EUR\t|            -\t|     -\t| -\t|",
		"| ab\t|      12.50\t|           5%\t|     3\t| 7\t|",
		"| cdef\t|    1200.00\t| \t|     -\t| x1\t|",
		"| g\t| \t|          60%\t|   1,5\t| 9\t|",
	]);
});

test("a right-aligned table is unchanged by a second pass and still parses", () => {
	const once = tabPadTouchedTables(NUMBERS, [[4, 4]]).lines;
	assert.deepStrictEqual(plain(tabPadTouchedTables(once, [[4, 4]]).changed), []);
	const t = plugin.findSmartTables(once.join("\n"))[0];
	assert.deepStrictEqual(Array.from(t.config.cols, (c) => c.type), ["text", "currency", "percentage", "text", "text"]);
	assert.deepStrictEqual(Array.from(t.config.cols[1].options), ["EUR"]);
});

test("number columns of a padded table still sort by value, and the padding survives the sort", () => {
	const doc = [
		"| Name | Amount | Share | Time |",
		"| --- | ---: | --- | --- |",
		"| __text | __currency | __percentage | __timespan |",
		"| a | 1200.00 | 60% | 1:00:00 |",
		"| b | 59.5 | 5% | PT3h |",
		"| c | 100 | 100% | 0:05:00 |",
		"| d | | 7% | PT1M |",
		"| e | 9 | 15% | 2:00:00 |",
	];
	const padded = tabPadTouchedTables(doc, [[3, 3]]).lines;
	const t = plugin.findSmartTables(padded.join("\n"))[0];
	const column = (c) => Array.from(plugin.sortTableRows(padded, t, c, false)).slice(1).map((r) => plugin.splitRowCells(r)[c] || "");
	assert.deepStrictEqual(column(1), ["9", "59.5", "100", "1200.00", ""]);
	assert.deepStrictEqual(column(2), ["5%", "7%", "15%", "60%", "100%"]);
	assert.deepStrictEqual(column(3), ["PT1M", "0:05:00", "1:00:00", "2:00:00", "PT3h"]);
	const sorted = padded.slice(0, 2).concat(Array.from(plugin.sortTableRows(padded, t, 1, false)));
	assert.deepStrictEqual(plain(tabPadTouchedTables(sorted, [[3, 3]]).changed), []);
});

test("an untyped column of numbers sorts by value, - and empty cells last", () => {
	const doc = ["| Name | Qty | Code |", "| --- | --- | --- |", "| __text | | |",
		"| a | 4.2 | 7 |", "| b | 12 | x1 |", "| c | 4.10 | 9 |", "| d | - | 10 |", "| e | -3 | 8 |", "| f | 1,5 | 2 |", "| g | 1,200 | 1 |", "| h | | 3 |"];
	const t = plugin.findSmartTables(doc.join("\n"))[0];
	const column = (c, desc) => Array.from(plugin.sortTableRows(doc, t, c, desc)).slice(1).map((r) => plugin.splitRowCells(r)[c]);
	assert.deepStrictEqual(column(1, false), ["-3", "1,5", "4.10", "4.2", "12", "1,200", "-", ""]);
	assert.deepStrictEqual(column(1, true), ["1,200", "12", "4.2", "4.10", "1,5", "-3", "-", ""]);
	// Code holds x1, so it stays a text column: digit runs compared, x1 after the numbers.
	assert.deepStrictEqual(column(2, false), ["1", "2", "3", "7", "8", "9", "10", "x1"]);
});

test("a delimiter cell is stretched with dashes, its colons kept", () => {
	assert.strictEqual(tabPadRow("| --: | :-: | - |", new Map([[0, 6], [1, 5], [2, 4]]), true), "| -----:\t| :---:\t| ----\t|");
});

// A fake transaction over `text` with one change at [fromB, toB] of the new document.
function fakeTransaction(text, fromB, toB, userEvent) {
	const lines = text.split("\n");
	const starts = [];
	let pos = 0;
	for (const l of lines) {
		starts.push(pos);
		pos += l.length + 1;
	}
	const line = (n) => ({ number: n, from: starts[n - 1], to: starts[n - 1] + lines[n - 1].length, text: lines[n - 1] });
	const lineAt = (p) => line(starts.filter((s) => s <= p).length);
	return {
		docChanged: true,
		isUserEvent: (e) => e === userEvent,
		newDoc: { toString: () => text, line, lineAt },
		changes: { iterChangedRanges: (f) => f(fromB, toB, fromB, toB) },
	};
}

test("the editor filter pads the table of a plugin write in the same transaction", () => {
	setTabPadding(true);
	try {
		const text = ["Intro", ...SMART].join("\n");
		const tr = fakeTransaction(text, text.indexOf("[x]"), text.indexOf("[x]") + 3, "tf.write");
		const out = tabPaddingFilter()(tr);
		assert.ok(Array.isArray(out), "transaction plus padding changes");
		assert.strictEqual(out[0], tr);
		assert.strictEqual(out[1].sequential, true);
		assert.deepStrictEqual(plain(out[1].changes.map((c) => c.insert)), ["| Task\t| Done\t|", "| ----\t| :--:\t|", "| __text\t| __\t|", "| a\t| [x]\t|"]);
		assert.strictEqual(out[1].changes[0].from, "Intro\n".length);
	} finally {
		setTabPadding(false);
	}
});

test("the editor filter ignores the user's typing and the option switched off", () => {
	const text = SMART.join("\n");
	setTabPadding(true);
	try {
		const typing = fakeTransaction(text, 0, 1, "input.type");
		assert.strictEqual(tabPaddingFilter()(typing), typing);
	} finally {
		setTabPadding(false);
	}
	const write = fakeTransaction(text, 0, 1, "tf.write");
	assert.strictEqual(tabPaddingFilter()(write), write);
});

// Minimal Obsidian Editor over a string: getLine, getValue, setLine, transaction, replaceRange.
function fakeEditor(text) {
	let lines = text.split("\n");
	const offset = (p) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch;
	const replace = (insert, from, to) => {
		const doc = lines.join("\n");
		lines = (doc.slice(0, offset(from)) + insert + doc.slice(offset(to || from))).split("\n");
	};
	return {
		transactions: 0,
		getCursor: () => ({ line: 2, ch: 0 }),
		lineCount: () => lines.length,
		getLine: (n) => lines[n],
		getValue: () => lines.join("\n"),
		setLine: (n, s) => (lines[n] = s),
		replaceRange: replace,
		transaction(tx) {
			this.transactions++;
			// Apply bottom-up so earlier offsets stay valid.
			tx.changes.slice().sort((a, b) => b.from.line - a.from.line).forEach((c) => replace(c.text, c.from, c.to));
		},
		text: () => lines.join("\n"),
	};
}

function writeBack(editor, rowIndex, colIndex, value) {
	const view = { file: { path: "n.md" }, editor };
	const self = { app: { workspace: { getActiveViewOfType: () => view } } };
	const ctx = { sourcePath: "n.md", getSectionInfo: () => ({ lineStart: 0 }) };
	plugin.module.exports.prototype.writeBackCell.call(self, {}, ctx, rowIndex, colIndex, value);
}

test("a Reading view write-back pads the table in one editor transaction", () => {
	setTabPadding(true);
	try {
		const editor = fakeEditor(SMART.join("\n"));
		writeBack(editor, 1, 1, "[ ]");
		assert.strictEqual(editor.transactions, 1);
		assert.strictEqual(editor.text(), ["| Task\t| Done\t|", "| ----\t| :--:\t|", "| __text\t| __\t|", "| a\t| [ ]\t|"].join("\n"));
	} finally {
		setTabPadding(false);
	}
});

test("with the option off a write-back changes only the cell", () => {
	const editor = fakeEditor(SMART.join("\n"));
	writeBack(editor, 1, 1, "[ ]");
	assert.strictEqual(editor.text(), [...SMART.slice(0, 3), "| a     | [ ] |"].join("\n"));
});

test("the mark command writes the whole table padded, with its new type row", () => {
	setTabPadding(true);
	try {
		const editor = fakeEditor(["| Task | Done |", "| ---- | ---- |", "| a    | [x]  |"].join("\n"));
		plugin.module.exports.prototype.markTableAsSmart.call({}, editor);
		assert.strictEqual(editor.text(), ["| Task\t| Done\t|", "| ----\t| ----\t|", "| __text\t| __\t|", "| a\t| [x]\t|"].join("\n"));
	} finally {
		setTabPadding(false);
	}
});
