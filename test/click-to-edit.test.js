"use strict";

/*
 * Tests that a left click on a Live Preview widget cell moves the cursor into that cell's
 * source (handing the table to Obsidian's table editor), while clicks on controls and
 * links, and other mouse buttons, are left to those elements. Run: npm test
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
const { sourcePosOfClick, cellSourcePos, buildSmartTableDecorations } = loadPlugin({ RangeSetBuilder, Decoration });

// Fake element: `closest` finds itself or the given ancestors by a tiny selector check.
function element(tag, attrs = {}, parent = null) {
	const el = {
		tag,
		attrs,
		getAttribute: (name) => (name in attrs ? attrs[name] : null),
		closest(selector) {
			for (let e = el; e; e = e.parent) {
				for (const part of selector.split(",").map((s) => s.trim())) {
					const attr = part.match(/^\[(.+)\]$/);
					if (attr ? attr[1] in e.attrs : part === e.tag) return e;
				}
			}
			return null;
		},
		parent,
	};
	return el;
}

test("a left click on cell text moves the cursor to the cell's source", () => {
	const td = element("td", { "data-tf-pos": "42" });
	const span = element("span", {}, td);
	assert.strictEqual(sourcePosOfClick({ button: 0, target: span }), 42);
});

test("clicks on a checkbox, dropdown or link are left to them", () => {
	const td = element("td", { "data-tf-pos": "42" });
	for (const tag of ["input", "select", "a", "button"]) {
		assert.strictEqual(sourcePosOfClick({ button: 0, target: element(tag, {}, td) }), null, tag);
	}
});

test("right and middle clicks do not enter editing", () => {
	const td = element("td", { "data-tf-pos": "42" });
	assert.strictEqual(sourcePosOfClick({ button: 2, target: td }), null);
	assert.strictEqual(sourcePosOfClick({ button: 1, target: td }), null);
});

test("a click outside any cell does nothing", () => {
	assert.strictEqual(sourcePosOfClick({ button: 0, target: element("div") }), null);
});

test("the cursor goes after the cell's padding space", () => {
	assert.strictEqual(cellSourcePos({ text: "  abc ", from: 10, to: 16 }), 12);
	assert.strictEqual(cellSourcePos({ text: "   ", from: 10, to: 13 }), 13);
});

test("the widget knows the header cells, so a header click lands in the header row", () => {
	const lines = ["| Task | Done |", "| ---- | ---- |", "| __text | __ |", "| a | [x] |", "", "after"];
	const doc = lines.join("\n");
	const starts = [];
	let pos = 0;
	for (const l of lines) { starts.push(pos); pos += l.length + 1; }
	const state = {
		field: () => true,
		doc: { toString: () => doc, line: (n) => ({ from: starts[n - 1], to: starts[n - 1] + lines[n - 1].length, text: lines[n - 1] }) },
		selection: { main: { from: doc.length, to: doc.length } },
	};
	const { headerCells } = buildSmartTableDecorations(state)[0].deco.widget.data;
	assert.strictEqual(doc.slice(cellSourcePos(headerCells[1]), cellSourcePos(headerCells[1]) + 4), "Done");
});
