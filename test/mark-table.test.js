"use strict";

/*
 * Tests the "Mark table under cursor as Table Fields" command: it inserts a type row
 * (inferred from the first data row) and a second delimiter row below the header's
 * delimiter, and leaves tables alone that already have types (type rows or a comment).
 * The editor is a minimal fake over a string. Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

const plugin = loadPlugin();
const markTableAsSmart = plugin.module.exports.prototype.markTableAsSmart;

// Minimal Editor over a string document; replaceRange inserts at { line, ch }.
function fakeEditor(text, cursorLine) {
	let doc = text;
	const lines = () => doc.split("\n");
	return {
		getCursor: () => ({ line: cursorLine, ch: 0 }),
		lineCount: () => lines().length,
		getLine: (n) => lines()[n],
		replaceRange: (insert, pos) => {
			const ls = lines();
			let offset = pos.ch;
			for (let n = 0; n < pos.line; n++) offset += ls[n].length + 1;
			doc = doc.slice(0, offset) + insert + doc.slice(offset);
		},
		text: () => doc,
	};
}

const TABLE = ["| Task | Done | Due        |", "| ---- | ---- | ---------- |", "| a    | [x]  | 2026-10-13 |"].join("\n");

test("inserts a type row and a second delimiter below the header's delimiter", () => {
	const editor = fakeEditor("Intro\n\n" + TABLE + "\n\nOutro", 4);
	markTableAsSmart.call({}, editor);
	assert.strictEqual(
		editor.text(),
		[
			"Intro",
			"",
			"| Task | Done | Due        |",
			"| ---- | ---- | ---------- |",
			"| text | box | date |",
			"| ---- | ---- | ---------- |",
			"| a    | [x]  | 2026-10-13 |",
			"",
			"Outro",
		].join("\n")
	);
});

test("the marked table parses back with the inferred types", () => {
	const editor = fakeEditor(TABLE, 0);
	markTableAsSmart.call({}, editor);
	const tables = plugin.findSmartTables(editor.text());
	assert.strictEqual(tables.length, 1);
	assert.deepStrictEqual(Array.from(tables[0].config.cols, (c) => c.type), ["text", "checkbox", "date"]);
	assert.strictEqual(tables[0].dataStartLine, 4);
});

test("a table without data rows still gets a type section", () => {
	const editor = fakeEditor("| A | B |\n| - | - |", 0);
	markTableAsSmart.call({}, editor);
	assert.strictEqual(editor.text(), "| A | B |\n| - | - |\n| text | text |\n| - | - |");
});

test("a table that already has type rows is left alone", () => {
	const editor = fakeEditor(TABLE, 0);
	markTableAsSmart.call({}, editor);
	const once = editor.text();
	const again = fakeEditor(once, 0);
	markTableAsSmart.call({}, again);
	assert.strictEqual(again.text(), once);
});

test("a table with a config comment is left alone", () => {
	const doc = "<!-- table-fields id=\"t\" v=\"1\"\ncols:\n  - {name: \"Task\", type: \"text\"}\n-->\n\n" + TABLE;
	const editor = fakeEditor(doc, 5);
	markTableAsSmart.call({}, editor);
	assert.strictEqual(editor.text(), doc);
});

test("a pipe line without a delimiter row below is not touched", () => {
	const doc = "a | b\nnot a delimiter";
	const editor = fakeEditor(doc, 0);
	markTableAsSmart.call({}, editor);
	assert.strictEqual(editor.text(), doc);
});
