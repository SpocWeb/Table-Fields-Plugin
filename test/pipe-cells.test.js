"use strict";

/*
 * Tests for table-row cell splitting: a pipe is cell content, not a column separator,
 * when escaped (\|), inside a [[wikilink|alias]], or inside `inline code`.
 * Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

const { splitRow, getCellRanges, escapePipes, unescapePipes } = loadPlugin();

// Trimmed cells after the leading pipe; copied to a host array so deepStrictEqual
// does not trip over the vm context's own Array prototype.
function cells(line) {
	const { parts, cellOffset } = splitRow(line);
	return Array.from(parts.slice(cellOffset), (s) => s.trim());
}

test("plain row", () => {
	assert.deepStrictEqual(cells("| a | b | c |"), ["a", "b", "c", ""]);
});

test("row without leading pipe", () => {
	assert.deepStrictEqual(cells("a | b"), ["a", "b"]);
});

test("escaped pipe stays in the cell", () => {
	assert.deepStrictEqual(cells("| a\\|b | [x] |"), ["a\\|b", "[x]", ""]);
});

test("wikilink alias stays in the cell", () => {
	assert.deepStrictEqual(cells("| [[Note|Alias]] | [ ] |"), ["[[Note|Alias]]", "[ ]", ""]);
});

test("escaped wikilink alias stays in the cell", () => {
	assert.deepStrictEqual(cells("| [[Note\\|Alias]] | [ ] |"), ["[[Note\\|Alias]]", "[ ]", ""]);
});

test("inline code pipe stays in the cell", () => {
	assert.deepStrictEqual(cells("| `a|b` | x |"), ["`a|b`", "x", ""]);
});

test("double-backtick code span containing a single backtick", () => {
	assert.deepStrictEqual(cells("| ``a`|b`` | x |"), ["``a`|b``", "x", ""]);
});

test("unclosed backtick is literal text", () => {
	assert.deepStrictEqual(cells("| `a | b |"), ["`a", "b", ""]);
});

test("unclosed wikilink is literal text", () => {
	assert.deepStrictEqual(cells("| [[a | b |"), ["[[a", "b", ""]);
});

test("escaped backslash before a pipe still separates", () => {
	assert.deepStrictEqual(cells("| a\\\\| b |"), ["a\\\\", "b", ""]);
});

test("joining the parts restores the line exactly", () => {
	for (const line of ["| [[N|A]] | `x|y` | a\\|b | [x] |", "a|b", "|", ""]) {
		assert.strictEqual(splitRow(line).parts.join("|"), line);
	}
});

test("write-back replaces the intended cell only", () => {
	const line = "| [[Note|Alias]] | `c|d` | [ ] |";
	const { parts, cellOffset } = splitRow(line);
	parts[cellOffset + 2] = " [x] ";
	assert.strictEqual(parts.join("|"), "| [[Note|Alias]] | `c|d` | [x] |");
});

test("getCellRanges returns absolute offsets of the real cells", () => {
	const line = "| [[N|A]] | [ ] |";
	const ranges = getCellRanges(line, 100);
	assert.strictEqual(ranges.length, 2);
	assert.strictEqual(ranges[0].text, " [[N|A]] ");
	assert.strictEqual(ranges[1].text, " [ ] ");
	assert.strictEqual(line.slice(ranges[1].from - 100, ranges[1].to - 100), " [ ] ");
});

test("escapePipes escapes once, unescapePipes reverses it", () => {
	assert.strictEqual(escapePipes("a|b"), "a\\|b");
	assert.strictEqual(escapePipes("a\\|b"), "a\\|b");
	assert.strictEqual(escapePipes("plain"), "plain");
	assert.strictEqual(unescapePipes("a\\|b"), "a|b");
});

test("an escaped written value does not split the row", () => {
	assert.deepStrictEqual(cells("| " + escapePipes("x|y") + " | z |"), ["x\\|y", "z", ""]);
});
