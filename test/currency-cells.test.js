"use strict";

/*
 * Tests how a currency cell is shown: with the column's ISO code in the locale's currency style,
 * without a code no currency sign (two decimals, grouping) and the column's unit after it.
 * Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

const { formatCurrency } = loadPlugin();

test("without a currency code no currency sign is shown", () => {
	const shown = formatCurrency("1", null);
	assert.doesNotMatch(shown, /\$|US|USD/);
	assert.match(shown, /^1[.,]00$/);
	assert.match(formatCurrency("3333333333", undefined), /^3.333.333.333[.,]00$/);
});

test("without a currency code the column's unit follows the number", () => {
	assert.match(formatCurrency("4.2", null, "k EUR"), /^4[.,]20 k EUR$/);
});

test("with a currency code the currency is shown", () => {
	assert.match(formatCurrency("1", "EUR"), /€/);
	assert.match(formatCurrency("1", "USD"), /\$/);
});

test("an unknown code is written before the number, a text cell is left as written", () => {
	assert.strictEqual(formatCurrency("2", "NOT-A-CODE"), "NOT-A-CODE 2.00");
	assert.strictEqual(formatCurrency("abc", "EUR"), null);
});
