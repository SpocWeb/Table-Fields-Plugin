"use strict";

/*
 * Tests when the Live Preview decoration field rebuilds: besides doc and selection
 * changes it must react to Live Preview being switched on after the editor is created,
 * or the typed table only appears once the cursor moves. StateField.define returns the
 * spec, so update() can be called with fake transactions. Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");
const { loadPlugin } = require("./load-plugin");

class RangeSetBuilder {
	constructor() { this.added = []; }
	add(from, to) { this.added.push({ from, to }); }
	finish() { return this.added; }
}
const Decoration = { none: "none", replace: (spec) => spec };
const StateField = { define: (spec) => spec };
const ctx = loadPlugin({ RangeSetBuilder, Decoration, StateField });
const field = vm.runInContext("smartTableField", ctx);

const DOC = [
	"<!-- table-fields id=\"t\" v=\"1\"",
	"cols:",
	"  - {name: \"Done\", type: \"checkbox\"}",
	"-->",
	"",
	"| Done |",
	"| ---- |",
	"| [x]  |",
	"",
	"after",
].join("\n");

function fakeState(livePreview, cursor = DOC.length) {
	const lines = DOC.split("\n");
	const starts = [];
	let pos = 0;
	for (const l of lines) { starts.push(pos); pos += l.length + 1; }
	return {
		field: () => livePreview,
		doc: {
			toString: () => DOC,
			line: (n) => ({ from: starts[n - 1], to: starts[n - 1] + lines[n - 1].length, text: lines[n - 1] }),
		},
		selection: { main: { from: cursor, to: cursor } },
	};
}

const tr = (startState, state, extra = {}) =>
	Object.assign({ startState, state, docChanged: false, selection: undefined, reconfigured: false }, extra);

test("Source mode at creation yields no table", () => {
	assert.strictEqual(field.create(fakeState(false)), "none");
});

test("switching to Live Preview without doc or cursor change renders the table", () => {
	const before = field.create(fakeState(false));
	const after = field.update(before, tr(fakeState(false), fakeState(true)));
	assert.notStrictEqual(after, "none");
	assert.strictEqual(after.length, 1);
});

test("switching back to Source mode removes the table", () => {
	const lp = field.create(fakeState(true));
	assert.strictEqual(lp.length, 1);
	assert.strictEqual(field.update(lp, tr(fakeState(true), fakeState(false))), "none");
});

test("a reconfigure rebuilds the decorations", () => {
	const stale = field.create(fakeState(false));
	assert.notStrictEqual(field.update(stale, tr(fakeState(true), fakeState(true), { reconfigured: true })), stale);
});

test("an unrelated transaction keeps the existing decorations", () => {
	const deco = field.create(fakeState(true));
	assert.strictEqual(field.update(deco, tr(fakeState(true), fakeState(true))), deco);
});
