"use strict";

/*
 * Tests that Live Preview text cells are handed to Obsidian's MarkdownRenderer
 * (so <br>, links, bold and code render like in a native table), while typed cells
 * keep their own rendering. MarkdownRenderer is a recording stub. Run: npm test
 */

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

let calls = [];
let failRender = false;
const MarkdownRenderer = {
	render: async (app, markdown, el, sourcePath, component) => {
		calls.push({ app, markdown, el, sourcePath, component });
		if (failRender) throw new Error("render failed");
	},
};
const { renderWidgetCell, renderCellMarkdown } = loadPlugin({ MarkdownRenderer });

const app = { name: "app" };
const component = { name: "component" };
const md = { app, sourcePath: "folder/note.md", component };

// Minimal stand-in for the HTMLTableCellElement methods the cell renderers use.
function fakeTd() {
	const classes = new Set();
	return {
		textContent: "",
		attrs: {},
		classes,
		classList: { add: (c) => classes.add(c) },
		setAttr(name, value) { this.attrs[name] = value; },
		setText(text) { this.textContent = text; },
	};
}

const cell = (text) => ({ text, from: 0, to: text.length });

beforeEach(() => {
	calls = [];
	failRender = false;
});

test("text cell with <br> goes to MarkdownRenderer with the note's path", () => {
	const td = fakeTd();
	renderWidgetCell(td, { type: "text" }, cell(" line 1<br>line 2 "), null, md);
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].markdown, "line 1<br>line 2");
	assert.strictEqual(calls[0].el, td);
	assert.strictEqual(calls[0].app, app);
	assert.strictEqual(calls[0].sourcePath, "folder/note.md");
	assert.strictEqual(calls[0].component, component);
	assert.ok(td.classes.has("tf-cell-md"));
});

test("unknown column type renders as Markdown too", () => {
	renderWidgetCell(fakeTd(), { type: "whatever" }, cell("**bold**"), null, md);
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].markdown, "**bold**");
});

test("escaped pipes are unescaped before rendering, so an aliased link stays one link", () => {
	renderWidgetCell(fakeTd(), { type: "text" }, cell(" [[Note\\|Alias]] "), null, md);
	assert.strictEqual(calls[0].markdown, "[[Note|Alias]]");
});

test("without a render context the cell falls back to plain text", () => {
	const td = fakeTd();
	renderWidgetCell(td, { type: "text" }, cell("a<br>b"), null, null);
	assert.strictEqual(calls.length, 0);
	assert.strictEqual(td.textContent, "a<br>b");
	assert.ok(!td.classes.has("tf-cell-md"));
});

test("empty cell is not sent to the renderer", () => {
	const td = fakeTd();
	renderCellMarkdown(td, "", md);
	assert.strictEqual(calls.length, 0);
	assert.strictEqual(td.textContent, "");
});

test("typed cells keep their own rendering and skip MarkdownRenderer", () => {
	const date = fakeTd();
	renderWidgetCell(date, { type: "date" }, cell("2026-10-12"), null, md);
	assert.ok(date.classes.has("tf-cell-date"));
	assert.strictEqual(date.attrs.title, "2026-10-12");

	const pct = fakeTd();
	renderWidgetCell(pct, { type: "percentage" }, cell("60%"), null, md);
	assert.strictEqual(pct.textContent, "60%");

	assert.strictEqual(calls.length, 0);
});

test("a failing render falls back to the raw cell text", async () => {
	failRender = true;
	const td = fakeTd();
	renderCellMarkdown(td, "a<br>b", md);
	await new Promise((resolve) => setImmediate(resolve));
	assert.strictEqual(td.textContent, "a<br>b");
});
