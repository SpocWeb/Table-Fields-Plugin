"use strict";

/*
 * Tests the int and float types: an int cell shows a whole number with locale grouping (other
 * text as written); a float column shows all its cells with the same decimal places (the most in
 * the column, or an option row like __3); both sort by value, are guessed by the mark command,
 * and with tab padding a float column is decimal-aligned in the source.
 * Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

const plugin = loadPlugin();
const { formatIntCell, formatFloatCell, findSmartTables, sortTableRows, splitRowCells, tabPadTouchedTables } = plugin;
const plain = (x) => JSON.parse(JSON.stringify(x));

const TABLE = [
	"| Name | Count | Value |", // 0
	"| --- | --- | --- |", // 1
	"| __text | __int | __float |", // 2
	"| a | 1234567 | 1.5 |", // 3
	"| b | 12 | 12.25 |", // 4
	"| c | 2.5 | 0.125 |", // 5
	"| d | -3 | 3 |", // 6
];

test("an int cell shows a whole number with grouping, other text as written", () => {
	assert.match(formatIntCell("1234567"), /^1.234.567$/);
	assert.strictEqual(formatIntCell("-3"), "-3");
	assert.strictEqual(formatIntCell("2.5"), null);
	assert.strictEqual(formatIntCell("abc"), null);
});

test("a float column shows every cell with the most decimal places in it", () => {
	const col = findSmartTables(TABLE.join("\n"))[0].config.cols[2];
	assert.strictEqual(col.type, "float");
	assert.strictEqual(col.decimals, 3);
	assert.deepStrictEqual(["1.5", "12.25", "0.125", "3"].map((v) => formatFloatCell(v, col.decimals).replace(",", ".")), ["1.500", "12.250", "0.125", "3.000"]);
	assert.match(formatFloatCell("1234567.5", 1), /^1.234.567[.,]5$/);
	assert.strictEqual(formatFloatCell("n/a", 2), null);
});

test("an option row with one digit fixes a float column's decimal places", () => {
	const lines = TABLE.slice(0, 3).concat(["| - | - | __2 |"], TABLE.slice(3));
	assert.strictEqual(findSmartTables(lines.join("\n"))[0].config.cols[2].decimals, 2);
});

test("int and float columns sort by value", () => {
	const t = findSmartTables(TABLE.join("\n"))[0];
	const column = (c) => Array.from(sortTableRows(TABLE, t, c, false)).slice(1).map((r) => splitRowCells(r)[c]);
	assert.deepStrictEqual(column(1), ["-3", "2.5", "12", "1234567"]);
	assert.deepStrictEqual(column(2), ["0.125", "1.5", "3", "12.25"]);
});

test("with tab padding a float column is decimal-aligned, an int column right-aligned", () => {
	assert.deepStrictEqual(plain(tabPadTouchedTables(TABLE, [[3, 3]]).lines), [
		"| Name\t|   Count\t|   Value\t|",
		"| ---\t| -------\t| -------\t|",
		"| __text\t|   __int\t| __float\t|",
		"| a\t| 1234567\t|   1.5  \t|",
		"| b\t|      12\t|  12.25 \t|",
		"| c\t|     2.5\t|   0.125\t|",
		"| d\t|      -3\t|   3    \t|",
	]);
});

test("the mark command guesses int and float from the first data row", () => {
	assert.strictEqual(plugin.inferType("12"), "int");
	assert.strictEqual(plugin.inferType("-4"), "int");
	assert.strictEqual(plugin.inferType("1.5"), "float");
	assert.strictEqual(plugin.inferType("60%"), "percentage");
});
