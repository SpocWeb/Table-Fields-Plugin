"use strict";

/*
 * Spec of plan table-metadata-legend step 1 (skills/ByteSafeEdit/plans/table-metadata-legend.md in
 * the AI repo; decisions L1-L20 in its DECISIONS.md): a visible metadata table above a table
 * (| Column | Type | Options | Unit | Scale | Description |), keyed __unit: and __scale: rows, the
 * merge with the __ rows (rows win, L7) and the header tooltip and suffix (L14).
 * Tests marked PENDING are fixed for the executor: remove the marker, never edit the test.
 * Run: npm test
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { loadPlugin } = require("./load-plugin");

const PENDING = { skip: "pending: plan table-metadata-legend step 1" };

const plugin = loadPlugin();
const { findSmartTables, findMetaTableAbove, parseTypeRows, sortTableRows, headerTooltip, headerSuffix } = plugin;

// Values from the plugin's vm context compared as plain JSON (its arrays have another prototype).
const json = (x) => JSON.parse(JSON.stringify(x));

// The plan's target format: metadata table, title line, data table with __ option rows.
const TARGET = [
	"Columns of [Runs](#runs) <a id=\"runs-meta\"></a>:",              // 0
	"",                                                                // 1
	"| Column | Type   | Unit | Scale | Description                    |", // 2 metadata header
	"|--------|--------|------|------:|--------------------------------|", // 3
	"| Min    |        | ms   |       | fastest run                    |", // 4
	"| Fail   |        |      |       | runs that ended with an error  |", // 5
	"| Cost   |        | EUR  |  1000 | cost of all runs               |", // 6
	"| Status | select |      |       | state of the job's last run    |", // 7
	"| Done   | box    |      |       | reviewed by me                 |", // 8
	"",                                                                // 9
	"Runs <a id=\"runs\"></a>:",                                       // 10
	"",                                                                // 11
	"| n  | Min | Fail | Cost | Status  | Done |",                     // 12 data header
	"|---:|----:|-----:|-----:|---------|------|",                     // 13
	"| -  | -   | -    | -    | __Todo  | -    |",                     // 14 option rows
	"| -  | -   | -    | -    | __Doing | -    |",                     // 15
	"| -  | -   | -    | -    | __Done  | -    |",                     // 16
	"| 12 | 340 |    1 |  4.2 | Doing   | [ ]  |",                     // 17 data
];

// The same metadata written by hand as keyed __ rows (L18).
const KEYED = [
	"| Min       | Cost         | Status   |", // 0
	"|-----------|--------------|----------|", // 1
	"| -         | __currency   | __select |", // 2 type row
	"| __unit:ms | __unit:EUR   | -        |", // 3 keyed row
	"| -         | __scale:1000 | -        |", // 4 keyed row
	"| -         | -            | __Todo   |", // 5 option row
	"| 340       | 4.2          | Todo     |", // 6 data
];

const col = (name, type, options, unit, scale, description) => ({ name, type, options, unit, scale, description });

test("a metadata table above a table is read by column name: empty cells null, box as checkbox, Scale a number", PENDING, () => { // L2, L4, L11, L12
	assert.deepStrictEqual(json(findMetaTableAbove(TARGET, 12)), {
		start: 2,
		end: 8,
		cols: [
			col("Min", null, [], "ms", null, "fastest run"),
			col("Fail", null, [], null, null, "runs that ended with an error"),
			col("Cost", null, [], "EUR", 1000, "cost of all runs"),
			col("Status", "select", [], null, null, "state of the job's last run"),
			col("Done", "checkbox", [], null, null, "reviewed by me"),
		],
	});
});

test("known metadata columns in any order, unknown ones ignored, options split at unescaped commas", PENDING, () => { // L11, L19
	const lines = ["| Column | Note | Options | Type |", "|---|---|---|---|", "| S | mine | Todo, Doing\\, waiting, a\\|b | select |", "", "| S |", "|---|", "| Todo |"];
	assert.deepStrictEqual(json(findMetaTableAbove(lines, 4).cols), [col("S", "select", ["Todo", "Doing, waiting", "a|b"], null, null, null)]);
});

test("a metadata table applies to the next table only across blank lines and one title line", PENDING, () => { // L3
	const meta = ["| Column | Description |", "|---|---|", "| A | the a |"];
	const cases = [
		[[...meta, "", "| A |", "|---|"], 4],
		[[...meta, "", "Runs <a id=\"runs\"></a>:", "", "| A |", "|---|"], 6],
		[[...meta, "", "first line", "second line", "", "| A |", "|---|"], 7],
		[[...meta, "", "| B |", "|---|", "", "| A |", "|---|"], 7],
		[["| X | Y |", "|---|---|", "", "| A |", "|---|"], 3],
	];
	assert.deepStrictEqual(cases.map(([lines, header]) => findMetaTableAbove(lines, header) !== null), [true, true, false, false, false]);
});

test("the table below a metadata table is smart: types from the metadata table, options from __ rows without a type row", PENDING, () => { // L16, L17
	const tables = findSmartTables(TARGET.join("\n"));
	assert.strictEqual(tables.length, 1);
	const [t] = tables;
	assert.strictEqual(t.headerLine, 12);
	assert.deepStrictEqual(json(t.configLines), [14, 15, 16]);
	assert.deepStrictEqual(json(t.meta), { start: 2, end: 8 });
	assert.deepStrictEqual(json(t.config.cols), [
		col("n", "text", [], null, null, null),
		col("Min", "text", [], "ms", null, "fastest run"),
		col("Fail", "text", [], null, null, "runs that ended with an error"),
		col("Cost", "text", [], "EUR", 1000, "cost of all runs"),
		col("Status", "select", ["Todo", "Doing", "Done"], null, null, "state of the job's last run"),
		col("Done", "checkbox", [], null, null, "reviewed by me"),
	]);
});

test("a metadata table with descriptions only makes the table below a smart table of text columns", PENDING, () => { // L4, L14
	const doc = ["| Column | Description |", "|---|---|", "| HRV | heart rate variability |", "", "| Day | HRV |", "|---|---:|", "| Mo | 42 |"].join("\n");
	const tables = findSmartTables(doc);
	assert.strictEqual(tables.length, 1);
	assert.deepStrictEqual(json(tables[0].config.cols), [
		col("Day", "text", [], null, null, null),
		col("HRV", "text", [], null, null, "heart rate variability"),
	]);
});

test("keyed __unit: and __scale: rows are config rows giving unit and scale, never options", PENDING, () => { // L18
	const parsed = parseTypeRows(KEYED, 0, KEYED.length - 1);
	assert.deepStrictEqual(json(parsed.configLines), [2, 3, 4, 5]);
	assert.deepStrictEqual(json(parsed.config.cols).map(({ name, type, options, unit, scale }) => ({ name, type, options, unit, scale })), [
		{ name: "Min", type: "text", options: [], unit: "ms", scale: null },
		{ name: "Cost", type: "currency", options: [], unit: "EUR", scale: 1000 },
		{ name: "Status", type: "select", options: ["Todo"], unit: null, scale: null },
	]);
});

test("the __ rows win over the metadata table for type and unit; the description still comes from it", PENDING, () => { // L7
	const doc = [
		"| Column | Type   | Unit | Description |",
		"|--------|--------|------|-------------|",
		"| Min    |        | ms   | fastest run |",
		"| Status | select |      | state       |",
		"",
		"| Min      | Status |",
		"|----------|--------|",
		"| -        | __date |",
		"| __unit:s | -      |",
		"| 340      | 2026-11-19 |",
	].join("\n");
	const [t] = findSmartTables(doc);
	assert.deepStrictEqual(json(t.config.cols), [
		col("Min", "text", [], "s", null, "fastest run"),
		col("Status", "date", [], null, null, "state"),
	]);
});

test("header tooltip: description with unit and scale in parentheses, unit alone, or nothing", PENDING, () => { // L14, L15
	const cols = [
		{ description: "fastest run", unit: "ms" },
		{ description: "cost of all runs", unit: "EUR", scale: 1000 },
		{ unit: "ms" },
		{ description: "reviewed by me" },
		{},
	];
	assert.deepStrictEqual(cols.map(headerTooltip), ["fastest run (ms)", "cost of all runs (k EUR)", "ms", "reviewed by me", ""]);
});

test("header suffix in Reading view: [unit] with scale 1000 as k, 1e6 as M, else ×scale", PENDING, () => { // L12, L14
	const cols = [{ unit: "ms" }, { unit: "EUR", scale: 1000 }, { unit: "EUR", scale: 1e6 }, { unit: "EUR", scale: 100 }, { scale: 1000 }, { description: "x" }];
	assert.deepStrictEqual(cols.map(headerSuffix), ["[ms]", "[k EUR]", "[M EUR]", "[×100 EUR]", "[k]", ""]);
});

// Characterization (passes now): keyed rows are already config rows by their cells.

test("keyed rows stay at the top when sorting, below the type row", () => { // L18
	const [t] = findSmartTables(KEYED.join("\n"));
	const sorted = sortTableRows(KEYED, t, 0, true);
	assert.deepStrictEqual(json(sorted.slice(0, 4)), KEYED.slice(2, 6));
});

test("Reading view hides keyed rows like the other config rows", () => { // L18
	const rows = [];
	for (let i = 0; i < KEYED.length - 2; i++) {
		const classes = new Set();
		rows.push({ classes, classList: { add: (c) => classes.add(c) }, children: [] });
	}
	const table = { classList: { add: () => {} }, querySelectorAll: () => rows };
	plugin.module.exports.prototype.enhanceTables.call(
		{ enhanceCell: () => {} },
		{ findAll: () => [table] },
		{ getSectionInfo: () => ({ text: KEYED.join("\n"), lineStart: 0 }) }
	);
	assert.deepStrictEqual(rows.map((r) => r.classes.has("tf-config-row")), [true, true, true, true, false]);
});
