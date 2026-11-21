"use strict";

/*
 * Tests the large-table behaviour of the Live Preview field: the document is parsed once per
 * document object (a cursor move re-uses it and its widgets), a widget's rows are only computed
 * when it draws, and a plain text cell skips MarkdownRenderer. Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");
const { loadPlugin } = require("./load-plugin");

class RangeSetBuilder {
	constructor() { this.added = []; }
	add(from, to, spec) { this.added.push({ from, to, spec }); }
	finish() { return this.added; }
}
const Decoration = { none: "none", replace: (spec) => spec };
const StateField = { define: (spec) => spec };
let renders = 0;
const MarkdownRenderer = { render: async () => { renders++; } };
const ctx = loadPlugin({ RangeSetBuilder, Decoration, StateField, MarkdownRenderer });
const field = vm.runInContext("smartTableField", ctx);

const ROWS = 2000;
const LINES = ["| Name | Span |", "| ---- | ---- |", "| __text | __timespan |"];
for (let i = 0; i < ROWS; i++) LINES.push("| row " + i + " | PT" + (i % 5) + "h |");
LINES.push("", "after");
const DOC = LINES.join("\n");

function makeDoc() {
	const starts = [];
	let pos = 0;
	for (const l of LINES) { starts.push(pos); pos += l.length + 1; }
	let toStrings = 0;
	const doc = {
		toString: () => { toStrings++; return DOC; },
		line: (n) => ({ from: starts[n - 1], to: starts[n - 1] + LINES[n - 1].length, text: LINES[n - 1] }),
		get toStrings() { return toStrings; },
	};
	return doc;
}

const stateOf = (doc, cursor) => ({
	field: () => true,
	doc,
	selection: { main: { from: cursor, to: cursor } },
});

const tr = (startState, state, extra = {}) =>
	Object.assign({ startState, state, docChanged: false, selection: {}, reconfigured: false }, extra);

test("a cursor move re-uses the parsed document and the widget", () => {
	const doc = makeDoc();
	const outside = DOC.length;
	const first = field.create(stateOf(doc, outside));
	assert.strictEqual(first.length, 1);
	const second = field.update(first, tr(stateOf(doc, outside), stateOf(doc, outside - 1)));
	assert.strictEqual(second.length, 1);
	assert.strictEqual(doc.toStrings, 1, "document parsed once");
	assert.strictEqual(second[0].spec.widget, first[0].spec.widget, "same widget instance");
});

test("a cursor inside the table shows the source, back outside shows the widget again", () => {
	const doc = makeDoc();
	const inside = 5;
	const deco = field.create(stateOf(doc, inside));
	assert.strictEqual(deco.length, 0);
	const back = field.update(deco, tr(stateOf(doc, inside), stateOf(doc, DOC.length)));
	assert.strictEqual(back.length, 1);
	assert.strictEqual(doc.toStrings, 1);
});

test("rows are computed on first use only, and only once", () => {
	const doc = makeDoc();
	const deco = field.create(stateOf(doc, DOC.length));
	const data = deco[0].spec.widget.data;
	const desc = Object.getOwnPropertyDescriptor(data, "rows");
	assert.ok(desc.get, "rows is a lazy getter");
	const rows = data.rows;
	assert.strictEqual(rows.length, ROWS);
	assert.strictEqual(data.rows, rows);
});

test("a plain text cell skips MarkdownRenderer, one with markup does not", () => {
	const { renderCellMarkdown } = ctx;
	const td = { textContent: "" };
	const md = { app: {}, sourcePath: "n.md", component: {} };
	renders = 0;
	renderCellMarkdown(td, "plain words 123", md);
	assert.strictEqual(renders, 0);
	assert.strictEqual(td.textContent, "plain words 123");
	renderCellMarkdown({ textContent: "", classList: { add() {} } }, "a **b**", md);
	assert.strictEqual(renders, 1);
});
