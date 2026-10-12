"use strict";

/*
 * Tests the "Mark table under cursor as Table Fields" command: the config comment it
 * inserts is followed by an empty line, which Obsidian needs to render the table.
 * The editor is a minimal fake that applies replaceRange to an array of lines. Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

const plugin = loadPlugin();
const markTableAsSmart = plugin.module.exports.prototype.markTableAsSmart;

// Minimal Editor: line-based document, insert-only replaceRange at { line, ch: 0 }.
function fakeEditor(text, cursorLine) {
	let lines = text.split("\n");
	return {
		getCursor: () => ({ line: cursorLine, ch: 0 }),
		lineCount: () => lines.length,
		getLine: (n) => lines[n],
		replaceRange: (insert, pos) => {
			assert.strictEqual(pos.ch, 0);
			lines = [...lines.slice(0, pos.line), ...(insert + lines[pos.line]).split("\n"), ...lines.slice(pos.line + 1)];
		},
		text: () => lines.join("\n"),
	};
}

const TABLE = ["| Task | Done |", "| ---- | ---- |", "| a    | [x]  |"].join("\n");

test("inserted comment is followed by one empty line, then the table", () => {
	const editor = fakeEditor("Intro\n\n" + TABLE + "\n\nOutro", 4);
	markTableAsSmart.call({}, editor);
	const lines = editor.text().split("\n");
	const end = lines.indexOf("-->");
	assert.ok(end > 0, "comment end found");
	assert.strictEqual(lines[end + 1], "");
	assert.strictEqual(lines[end + 2], "| Task | Done |");
	assert.ok(lines[2].startsWith("<!-- table-fields id=\"task\""));
});

test("inferred column types are written into the comment", () => {
	const editor = fakeEditor(TABLE, 0);
	markTableAsSmart.call({}, editor);
	const text = editor.text();
	assert.ok(text.includes("{name: \"Task\", type: \"text\"}"));
	assert.ok(text.includes("{name: \"Done\", type: \"checkbox\"}"));
});

test("a table that already has a config comment is left alone", () => {
	const editor = fakeEditor(TABLE, 0);
	markTableAsSmart.call({}, editor);
	const once = editor.text();
	const again = fakeEditor(once, once.split("\n").indexOf("| Task | Done |"));
	markTableAsSmart.call({}, again);
	assert.strictEqual(again.text(), once);
});
