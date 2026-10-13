"use strict";

/*
 * Tests the hand-over of a table to Obsidian's table editor after a click: the edited
 * table's range follows document edits, the widget is left out for it, and it comes back
 * only after the user has left the table (cursor outside, focus not in one of its cells).
 * StateField.define returns its spec; StateEffect values are plain fakes. Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");
const { loadPlugin } = require("./load-plugin");

class RangeSetBuilder {
	constructor() { this.added = []; }
	add(from, to, deco) { this.added.push({ from, to, deco }); }
	finish() { return this.added; }
}
const Decoration = { none: "none", replace: (spec) => spec };
const StateField = { define: (spec) => spec };
const StateEffect = { define: () => ({ of: (value) => ({ is: (type) => type === "editTable", value }) }) };
const ctx = loadPlugin({ RangeSetBuilder, Decoration, StateField, StateEffect });
const field = vm.runInContext("editedTableField", ctx);
const { shouldResumeTable, buildSmartTableDecorations } = ctx;

const effect = (value) => ({ is: () => true, value });
const noChanges = { mapPos: (p) => p };

test("a click effect sets the edited table, a null effect clears it", () => {
	const range = { from: 10, to: 50, since: 1 };
	const set = field.update(null, { docChanged: false, effects: [effect(range)] });
	assert.deepStrictEqual(set, range);
	assert.strictEqual(field.update(set, { docChanged: false, effects: [effect(null)] }), null);
});

test("the edited range follows edits before and inside the table", () => {
	const shift = { mapPos: (p) => p + 5 };
	const mapped = field.update({ from: 10, to: 50, since: 1 }, { docChanged: true, changes: shift, effects: [] });
	assert.deepStrictEqual({ from: mapped.from, to: mapped.to }, { from: 15, to: 55 });
	assert.strictEqual(field.update({ from: 1, to: 2, since: 1 }, { docChanged: false, changes: noChanges, effects: [] }).from, 1);
});

test("the widget comes back only after the user left the table", () => {
	const edited = { from: 100, to: 200, since: 0 };
	assert.strictEqual(shouldResumeTable(null, 300, 1000, false), false, "nothing edited");
	assert.strictEqual(shouldResumeTable(edited, 300, 100, false), false, "just clicked: Obsidian may still move the cursor");
	assert.strictEqual(shouldResumeTable(edited, 150, 1000, false), false, "cursor in the table source");
	assert.strictEqual(shouldResumeTable(edited, 300, 1000, true), false, "typing in one of Obsidian's cells");
	assert.strictEqual(shouldResumeTable(edited, 300, 1000, false), true, "cursor and focus elsewhere");
});

test("the widget is left out for the edited table only", () => {
	const lines = [
		"| A | B |", "| - | - |", "| __text | __ |", "| a | [x] |", "",
		"| C | D |", "| - | - |", "| __text | __ |", "| c | [ ] |", "", "after",
	];
	const doc = lines.join("\n");
	const starts = [];
	let pos = 0;
	for (const l of lines) { starts.push(pos); pos += l.length + 1; }
	const state = (edited) => ({
		field: (f) => (f === field ? edited : true),
		doc: { toString: () => doc, line: (n) => ({ from: starts[n - 1], to: starts[n - 1] + lines[n - 1].length, text: lines[n - 1] }) },
		selection: { main: { from: doc.length, to: doc.length } },
	});
	assert.strictEqual(buildSmartTableDecorations(state(null)).length, 2);
	const firstTable = { from: starts[0], to: starts[3] + lines[3].length, since: 0 };
	const decos = buildSmartTableDecorations(state(firstTable));
	assert.strictEqual(decos.length, 1);
	assert.strictEqual(decos[0].from, starts[5]);
});

test("widget cells know their row in Obsidian's table, config rows included", () => {
	const lines = ["| A | B |", "| - | - |", "| a | [x] |", "| __text | __ |", "| b | [ ] |", "", "after"];
	const doc = lines.join("\n");
	const starts = [];
	let pos = 0;
	for (const l of lines) { starts.push(pos); pos += l.length + 1; }
	const st = {
		field: (f) => (f === field ? null : true),
		doc: { toString: () => doc, line: (n) => ({ from: starts[n - 1], to: starts[n - 1] + lines[n - 1].length, text: lines[n - 1] }) },
		selection: { main: { from: doc.length, to: doc.length } },
	};
	const data = buildSmartTableDecorations(st)[0].deco.widget.data;
	assert.deepStrictEqual(Array.from(data.rows, (r) => r.line - (data.headerLine + 2)), [0, 2]);
	assert.deepStrictEqual({ from: data.from, to: data.to }, { from: 0, to: starts[4] + lines[4].length });
});
