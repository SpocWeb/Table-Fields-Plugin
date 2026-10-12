"use strict";

/*
 * Tests which source range the Live Preview widget replaces: only the table, so the
 * table-fields config comment above it stays visible. CodeMirror's RangeSetBuilder and
 * Decoration are recording stubs, and the editor state is a minimal fake. Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

let added = [];
class RangeSetBuilder {
	add(from, to, deco) { added.push({ from, to, deco }); }
	finish() { return added; }
}
const Decoration = { none: "none", replace: (spec) => spec };
const { buildSmartTableDecorations } = loadPlugin({ RangeSetBuilder, Decoration });

const DOC = [
	"Intro",                                          // line 1
	"<!-- table-fields id=\"t\" v=\"1\"",             // line 2
	"cols:",                                          // line 3
	"  - {name: \"Task\", type: \"text\"}",           // line 4
	"  - {name: \"Done\", type: \"checkbox\"}",       // line 5
	"-->",                                            // line 6
	"| Task | Done |",                                // line 7
	"| ---- | ---- |",                                // line 8
	"| a    | [x]  |",                                // line 9
	"",                                               // line 10
	"Outro",                                          // line 11
].join("\n");

// Minimal EditorState: Live Preview on, cursor at `cursor`, 1-based doc.line(n).
function fakeState(doc, cursor) {
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
		selection: { main: { from: cursor, to: cursor } },
	};
}

function build(doc, cursor) {
	added = [];
	buildSmartTableDecorations(fakeState(doc, cursor));
	return added;
}

const lineFrom = (doc, n) => fakeState(doc, 0).doc.line(n).from;
const lineTo = (doc, n) => fakeState(doc, 0).doc.line(n).to;

test("widget replaces header to last row, not the config comment", () => {
	const deco = build(DOC, 0);
	assert.strictEqual(deco.length, 1);
	assert.strictEqual(deco[0].from, lineFrom(DOC, 7));
	assert.strictEqual(deco[0].to, lineTo(DOC, 9));
});

test("config range still covers the whole comment for header-menu rewrites", () => {
	const { configRange } = build(DOC, 0)[0].deco.widget.data;
	assert.strictEqual(configRange.from, lineFrom(DOC, 2));
	assert.strictEqual(configRange.to, lineTo(DOC, 6));
});

test("cursor in the comment keeps the table rendered", () => {
	assert.strictEqual(build(DOC, lineFrom(DOC, 4) + 3).length, 1);
});

test("cursor in the table shows its source", () => {
	assert.strictEqual(build(DOC, lineFrom(DOC, 9) + 2).length, 0);
});

test("renaming a column in the comment changes the widget signature", () => {
	const before = build(DOC, 0)[0].deco.widget.data.signature;
	const after = build(DOC.replace("name: \"Task\"", "name: \"Todo\""), 0)[0].deco.widget.data.signature;
	assert.notStrictEqual(before, after);
});
