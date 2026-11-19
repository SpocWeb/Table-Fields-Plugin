"use strict";

/* Write-back of a type change into a metadata table (plan table-metadata-legend step 1). */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

const { findMetaTableAbove, metaWithType } = loadPlugin();
const json = (x) => JSON.parse(JSON.stringify(x));

const doc = (meta) => [...meta, "", "| A | B |", "|---|---|", "| 1 | 2 |"];

test("a type change replaces the Type cell of the column's row and keeps the other cells", () => {
	const lines = doc(["| Column | Type | Note |", "|---|---|---|", "| A | | mine |", "| B | date | x |"]);
	const meta = findMetaTableAbove(lines, 5);
	assert.deepStrictEqual(json(metaWithType(lines, meta, "A", "select")), ["| Column | Type | Note |", "|---|---|---|", "| A | select | mine |", "| B | date | x |"]);
});

test("a column without a row gets one appended", () => {
	const lines = doc(["| Column | Type | Note |", "|---|---|---|", "| B | date | x |"]);
	const meta = findMetaTableAbove(lines, 4);
	assert.deepStrictEqual(json(metaWithType(lines, meta, "A", "box")).slice(-1), ["| A | box |  |"]);
});

test("a metadata table without a Type column gets one as the last column", () => {
	const lines = doc(["| Column | Description |", "|---|---|", "| A | the a |"]);
	const meta = findMetaTableAbove(lines, 4);
	assert.deepStrictEqual(json(metaWithType(lines, meta, "A", "date")), ["| Column | Description | Type |", "| --- | --- | --- |", "| A | the a | date |"]);
});
