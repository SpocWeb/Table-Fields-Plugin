"use strict";

/*
 * Tests that a Live Preview text cell is rendered as inline Markdown, like a native table
 * cell: block syntax at its start (numbered or bulleted list, heading, quote) is escaped,
 * so `1. Tap ...<br>2. ...` stays one line of text instead of a list with margins.
 * Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

let rendered = [];
const MarkdownRenderer = { render: async (app, markdown) => { rendered.push(markdown); } };
const { inlineMarkdown, renderCellMarkdown } = loadPlugin({ MarkdownRenderer });

test("a numbered list start is escaped", () => {
	assert.strictEqual(inlineMarkdown("1. Tap **+**.<br>2. Done."), "1\\. Tap **+**.<br>2. Done.");
	assert.strictEqual(inlineMarkdown("12) Step"), "12\\) Step");
});

test("bullet, heading and quote starts are escaped", () => {
	assert.strictEqual(inlineMarkdown("- item"), "\\- item");
	assert.strictEqual(inlineMarkdown("* item"), "\\* item");
	assert.strictEqual(inlineMarkdown("## Title"), "\\## Title");
	assert.strictEqual(inlineMarkdown("> quoted"), "\\> quoted");
});

test("ordinary inline text is left alone", () => {
	for (const text of ["Open the app", "**bold** and [[Link|alias]]", "2026-10-13", "-1", "#tag", "1.5 GB"]) {
		assert.strictEqual(inlineMarkdown(text), text);
	}
});

test("text cells are rendered with the escaped text", () => {
	rendered = [];
	const td = { textContent: "", classList: { add: () => {} }, setText() {} };
	renderCellMarkdown(td, "1. Tap.<br>2. Done.", { app: {}, sourcePath: "n.md", component: {} });
	assert.deepStrictEqual(rendered, ["1\\. Tap.<br>2. Done."]);
});
