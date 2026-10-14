"use strict";

/*
 * Table Fields — v0.1
 * Goal of this spike (PRD §14): prove the #1 risk (Q2) — interactive typed cells that
 * write back to the EXACT Markdown source range, while the table stays a plain pipe table.
 *
 * Approach (grounded in research, matches decisions C5/C6):
 *   - registerMarkdownPostProcessor runs for BOTH Reading view and Live Preview's
 *     *inactive* (rendered) tables. This is the stable path (Q3).
 *   - ctx.getSectionInfo(el) hands back the full doc text + the table's source line range,
 *     so we can locate and replace the exact cell on write-back.
 *   - When the user clicks into the table in Live Preview, Obsidian natively reverts it to
 *     source (known limitation) — controls simply aren't shown then. That is the honest,
 *     non-surprising fallback the PRD §9 describes, not a bug.
 *
 * Config lives inside the table, in rows whose cells are all "__"-prefixed, "-" or empty (see
 * parseMarkedRows): a type row and option rows (one option per row and column, "-" for none).
 * They are found by their cells wherever a sort by column moves them; an ascending sort keeps
 * them in this order, because "__" sorts before "-" and "-" before the data:
 *   | Task   | Status   | Due    | Amount     | Done  |
 *   | ----   | ------   | ----   | --------   | ----  |
 *   | __text | __select | __date | __currency | __    |
 *   | -      | __Todo   | -      | __USD      | -     |
 *   | -      | __Doing  | -      | -          | -     |
 *   | PRD    | Doing    | 2026-07-22 | 1200   | [x]   |
 *
 * The older format, an HTML comment above the table followed by one empty line, is still read:
 *   <!-- table-fields id="tasks" v="1"
 *   cols:
 *     - {name: "Task",   type: "text"}
 *     - {name: "Status", type: "select", options: ["Todo","Doing","Done"]}
 *   -->
 */

const { Plugin, Notice, MarkdownView, Menu, PluginSettingTab, MarkdownRenderer, Component, Keymap, editorInfoField, editorLivePreviewField } = require("obsidian");
const { StateField, StateEffect, RangeSetBuilder, Prec } = require("@codemirror/state");
const { EditorView, Decoration, WidgetType, ViewPlugin } = require("@codemirror/view");

/* ------------------------------ config parsing ------------------------------ */

// Parse the body of a `<!-- table-fields ... -->` comment into { id, version, cols }.
function parseConfigBlock(raw) {
	const idMatch = raw.match(/id\s*=\s*"([^"]*)"/);
	const vMatch = raw.match(/\bv\s*=\s*"([^"]*)"/);
	const cols = [];
	const colRe = /-\s*\{([^}]*)\}/g;
	let m;
	while ((m = colRe.exec(raw)) !== null) {
		const body = m[1];
		const name = (body.match(/name\s*:\s*"([^"]*)"/) || [])[1] || "";
		const type = fieldType((body.match(/type\s*:\s*"([^"]*)"/) || [])[1]) || "text";
		let options = [];
		const optM = body.match(/options\s*:\s*\[([^\]]*)\]/);
		if (optM) {
			options = optM[1]
				.split(",")
				.map((s) => s.trim().replace(/^"|"$/g, ""))
				.filter((s) => s.length > 0);
		}
		cols.push({ name, type, options });
	}
	return { id: idMatch ? idMatch[1] : null, version: vMatch ? vMatch[1] : "1", cols };
}

// The table-fields config comment above a table's header line (blank lines allowed
// between): { start, end, config } with 0-based line indices, or null.
function findCommentAbove(lines, headerLine) {
	let i = headerLine - 1;
	// skip blank lines between the comment and the table
	while (i >= 0 && lines[i].trim() === "") i--;
	if (i < 0) return null;
	// the line at i must be the closing `-->` of a comment
	if (!/-->\s*$/.test(lines[i])) return null;
	// walk up to the opening `<!-- table-fields`
	let start = i;
	while (start >= 0 && !/<!--\s*table-fields\b/.test(lines[start])) start--;
	if (start < 0) return null;
	const block = lines.slice(start, i + 1).join("\n");
	const inner = block.replace(/^[\s\S]*?table-fields\b/, "").replace(/-->\s*$/, "");
	return { start, end: i, config: parseConfigBlock(inner) };
}

// Type names as written; `box` is the short name of `checkbox`, both are accepted.
const FIELD_TYPES = ["text", "box", "checkbox", "select", "date", "currency", "percentage"];

// The internal type of a written type name: lower case, `box` read as `checkbox`.
function fieldType(name) {
	const t = (name || "").trim().toLowerCase();
	return t === "box" ? "checkbox" : t;
}

// A GFM delimiter row: every cell is dashes with optional alignment colons.
function isDelimiterRow(line) {
	if (!line || !line.includes("-")) return false;
	const cells = splitRowCells(line);
	return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

// The row closing a type section: every cell ===. A second --- delimiter row is still
// accepted, but Obsidian's table editor deletes such a row when the cursor enters the table.
function isSectionEndRow(line) {
	if (!line) return false;
	const cells = splitRowCells(line);
	return cells.length > 0 && (cells.every((c) => /^=+$/.test(c)) || isDelimiterRow(line));
}

// Prefix of every type and option cell; a config row has only such cells and blank ones.
const CONFIG_MARK = "__";

// Content of an option row cell without an option. A sort by column puts "-" after the
// "__" cells and before the data, so the option rows stay below the type row.
const NO_OPTION = "-";

// Whether a config row cell holds nothing: empty or NO_OPTION.
function isBlankConfigCell(c) {
	return c === "" || c === NO_OPTION;
}

// Whether a table row is a config row: every cell blank or starting with CONFIG_MARK, and
// at least one starting with it.
function isMarkedRow(line) {
	const cells = splitRowCells(line || "");
	return cells.some((c) => c.startsWith(CONFIG_MARK)) && cells.every((c) => isBlankConfigCell(c) || c.startsWith(CONFIG_MARK));
}

// The cells of a config row without the mark (blank cells become empty).
function unmarkedCells(line) {
	return splitRowCells(line).map((c) => (c.startsWith(CONFIG_MARK) ? c.slice(CONFIG_MARK.length).trim() : isBlankConfigCell(c) ? "" : c));
}

// The type names of a config row read as type row: a lone CONFIG_MARK is the shortcut for box,
// a blank cell means text.
function typeCellsOf(line) {
	return splitRowCells(line).map((c) => (c === CONFIG_MARK ? "box" : c.startsWith(CONFIG_MARK) ? c.slice(CONFIG_MARK.length).trim() : isBlankConfigCell(c) ? "" : c));
}

// A type as written into a type row: box as the lone CONFIG_MARK, others prefixed.
function typeCellText(type) {
	return fieldType(type) === "checkbox" ? CONFIG_MARK : CONFIG_MARK + type;
}

// Whether cells are column types: each a known type or empty, at least one not empty.
function isTypeCells(cells) {
	return cells.some((t) => t !== "") && cells.every((t) => t === "" || FIELD_TYPES.includes(t.toLowerCase()));
}

// The column config from the header row, the type cells and the option rows' cells.
function configOf(headerCells, typeCells, optionRows) {
	const cols = headerCells.map((name, i) => ({
		name: unescapePipes(name),
		type: fieldType(typeCells[i]) || "text",
		options: [],
	}));
	for (const cells of optionRows) {
		cells.forEach((c, i) => {
			if (c && cols[i]) cols[i].options.push(unescapePipes(c));
		});
	}
	return { id: null, version: "1", cols };
}

// Config encoded inside the table itself in rows of only "__"-prefixed and blank cells:
//   | Task   | Status   | Due    |    <- header
//   | ----   | ------   | ----   |    <- delimiter
//   | __text | __select | __     |    <- type row (empty = text, a lone __ = box = checkbox)
//   | -      | __Todo   | -      |    <- option rows: one option per row and column, - = none
//   | -      | __Done   | -      |
//   | PRD    | Doing    | ...    |    <- data rows
// The rows may stand anywhere in the table (sorting by a column moves them), so they are
// found by their cells, not by position: the type row is the config row of type names.
// Returns { config, typeLine, configLines, marked: true } (0-based lines) or null.
function parseMarkedRows(lines, headerLine, lastRowLine) {
	const configLines = [];
	for (let ln = headerLine + 2; ln <= lastRowLine; ln++) {
		if (isMarkedRow(lines[ln])) configLines.push(ln);
	}
	const typeLine = configLines.find((ln) => isTypeCells(typeCellsOf(lines[ln])));
	if (typeLine === undefined) return null;
	const optionRows = configLines.filter((ln) => ln !== typeLine).map((ln) => unmarkedCells(lines[ln]));
	const config = configOf(splitRowCells(lines[headerLine]), typeCellsOf(lines[typeLine]), optionRows);
	return { config, typeLine, configLines, marked: true };
}

// The older unmarked format: type row right after the delimiter, option rows, then a row
// of === (or a second --- row) before the data rows.
// Returns { config, typeLine, configLines, marked: false } (0-based lines) or null.
function parsePositionalRows(lines, headerLine, lastRowLine) {
	const typeLine = headerLine + 2;
	if (typeLine > lastRowLine) return null;
	const types = splitRowCells(lines[typeLine]);
	if (!isTypeCells(types)) return null;
	let endLine = typeLine + 1;
	while (endLine <= lastRowLine && !isSectionEndRow(lines[endLine])) endLine++;
	if (endLine > lastRowLine) return null;
	const optionRows = [];
	for (let ln = typeLine + 1; ln < endLine; ln++) optionRows.push(splitRowCells(lines[ln]));
	const configLines = [];
	for (let ln = typeLine; ln <= endLine; ln++) configLines.push(ln);
	return { config: configOf(splitRowCells(lines[headerLine]), types, optionRows), typeLine, configLines, marked: false };
}

// The type rows of the table at headerLine..lastRowLine: marked, else the older positional
// format. Returns { config, typeLine, configLines, marked } or null.
function parseTypeRows(lines, headerLine, lastRowLine) {
	if (headerLine + 2 > lastRowLine || !isDelimiterRow(lines[headerLine + 1])) return null;
	return parseMarkedRows(lines, headerLine, lastRowLine) || parsePositionalRows(lines, headerLine, lastRowLine);
}

// Last row line of the table whose header is at headerLine.
function lastTableRow(lines, headerLine) {
	let m = headerLine;
	while (m + 1 < lines.length && lines[m + 1].trim() !== "" && lines[m + 1].includes("|")) m++;
	return m;
}

// Config of the table at headerLine..lastRowLine. Type rows inside the table win over a
// comment above it. Returns { config, configLines, typeLine, marked, comment } or null:
// configLines are the body lines holding config, not data (empty for the comment format);
// typeLine is set for type rows, comment ({ start, end }) for the comment format.
function resolveTable(lines, headerLine, lastRowLine) {
	const rows = parseTypeRows(lines, headerLine, lastRowLine);
	if (rows) return Object.assign({ comment: null }, rows);
	const comment = findCommentAbove(lines, headerLine);
	if (comment && comment.config.cols.length > 0) {
		return { config: comment.config, configLines: [], typeLine: null, marked: false, comment };
	}
	return null;
}

/* ------------------------------ cell utilities ------------------------------ */

const CHECKBOX_RE = /^\[[ xX]\]$/;

function isChecked(raw) {
	return /^\[[xX]\]$/.test(raw.trim());
}

// Index of the next run of exactly n backticks at or after `from`, or -1.
function findBacktickRun(line, from, n) {
	let i = from;
	while (i < line.length) {
		if (line[i] !== "`") { i++; continue; }
		let k = 0;
		while (line[i + k] === "`") k++;
		if (k === n) return i;
		i += k;
	}
	return -1;
}

// Indices of the pipes in a table row that separate cells. A pipe is cell content,
// not a separator, when escaped (\|), inside a [[wikilink|alias]], or inside `code`
// - the same pipes Obsidian keeps inside a cell when it renders the table.
function findSeparatorPipes(line) {
	const pipes = [];
	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (ch === "\\") { i += 2; continue; } // escaped char, e.g. \|
		if (ch === "`") {
			let n = 1;
			while (line[i + n] === "`") n++;
			const close = findBacktickRun(line, i + n, n);
			i = close < 0 ? i + n : close + n; // unclosed run is literal text
			continue;
		}
		if (ch === "[" && line[i + 1] === "[") {
			const close = line.indexOf("]]", i + 2);
			if (close >= 0) { i = close + 2; continue; }
		}
		if (ch === "|") pipes.push(i);
		i++;
	}
	return pipes;
}

// Cell source -> displayed value: \| shows as |.
function unescapePipes(s) {
	return s.replace(/\\\|/g, "|");
}

// Value -> cell source: every pipe written as \| so it cannot split the row.
function escapePipes(s) {
	return unescapePipes(s).replace(/\|/g, "\\|");
}

// Split a Markdown table row into { parts, cellOffset } so cell index -> parts index.
// parts.join("|") restores the line exactly.
function splitRow(line) {
	const parts = [];
	let from = 0;
	for (const p of findSeparatorPipes(line)) {
		parts.push(line.slice(from, p));
		from = p + 1;
	}
	parts.push(line.slice(from));
	// leading pipe => parts[0] is empty/whitespace; cells begin at index 1
	const leading = parts.length > 0 && parts[0].trim() === "";
	return { parts, cellOffset: leading ? 1 : 0 };
}

function formatCurrency(raw, code) {
	const n = Number(String(raw).replace(/[, ]/g, ""));
	if (!isFinite(n)) return null;
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: code || "USD",
		}).format(n);
	} catch (e) {
		return (code || "$") + " " + n.toFixed(2);
	}
}

function formatDate(raw) {
	const v = raw.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
	const d = new Date(v + "T00:00:00");
	if (isNaN(d.getTime())) return null;
	return d.toLocaleDateString();
}

/* ------------------------------ the plugin ------------------------------ */

module.exports = class MarkdownSmartTablesPlugin extends Plugin {
	async onload() {
		// Reading view + inactive Live Preview content: markdown post-processor.
		this.registerMarkdownPostProcessor((el, ctx) => this.enhanceTables(el, ctx));

		// Live Preview (the native CM6-rendered table): a CodeMirror 6 editor extension
		// that replaces the table's source lines with our own interactive table widget.
		// Highest precedence: Obsidian's own table widget replaces the same lines, and for
		// replace decorations on the same range the higher-precedence source wins.
		this.registerEditorExtension([editedTableField, Prec.highest(smartTableField), resumeTablePlugin]);

		this.addCommand({
			id: "mark-as-table-fields",
			name: "Mark table under cursor as Table Fields",
			editorCallback: (editor) => this.markTableAsSmart(editor),
		});

		// Settings tab: Usage guide + copy-pasteable AI skill (two sub-tabs).
		this.addSettingTab(new TableFieldsSettingTab(this.app, this));

		console.log("[table-fields] loaded (v0.1 spike)");
	}

	onunload() {
		console.log("[table-fields] unloaded");
	}

	/* --- rendering path (Reading view + inactive Live Preview tables) --- */

	enhanceTables(el, ctx) {
		try {
			const tables = el.findAll ? el.findAll("table") : Array.from(el.querySelectorAll("table"));
			if (tables.length === 0) return;
			console.log("[tf] enhanceTables: found", tables.length, "table(s) in section");
			for (const table of tables) {
				const info = ctx.getSectionInfo(el);
				if (!info) {
					console.log("[tf]  -> getSectionInfo returned NULL (cannot locate source lines)");
					continue;
				}
				const lines = info.text.split("\n");
				const resolved = resolveTable(lines, info.lineStart, lastTableRow(lines, info.lineStart));
				console.log(
					"[tf]  -> lineStart=", info.lineStart,
					"| headerLine=", JSON.stringify((lines[info.lineStart] || "").slice(0, 40)),
					"| config cols=", resolved ? resolved.config.cols.length : "none"
				);
				if (!resolved) continue; // plain table -> untouched
				const config = resolved.config;
				// Type, option and end rows render as body rows (anywhere after a sort): hide
				// them, but keep counting them so rowIndex still maps to lineStart + 2 + rowIndex.
				const configLines = new Set(resolved.configLines);

				table.classList.add("tf-table");
				const rows = Array.from(table.querySelectorAll("tbody tr"));
				console.log("[tf]  -> enhancing", rows.length, "row(s),", config.cols.length, "col(s)");
				rows.forEach((tr, rowIndex) => {
					if (configLines.has(info.lineStart + 2 + rowIndex)) {
						tr.classList.add("tf-config-row");
						return;
					}
					const cells = Array.from(tr.children).filter((c) => c.tagName === "TD");
					cells.forEach((td, colIndex) => {
						const col = config.cols[colIndex];
						if (!col) return;
						this.enhanceCell(td, col, rowIndex, colIndex, el, ctx);
					});
				});
			}
		} catch (e) {
			console.error("[tf] enhanceTables error:", e);
		}
	}

	enhanceCell(td, col, rowIndex, colIndex, el, ctx) {
		const raw = (td.textContent || "").trim();
		switch (col.type) {
			case "checkbox": {
				if (!CHECKBOX_RE.test(raw)) return;
				const input = td.createEl("input", { type: "checkbox" });
				input.checked = isChecked(raw);
				input.classList.add("tf-checkbox");
				td.textContent = "";
				td.appendChild(input);
				td.classList.add("tf-cell-center");
				this.registerDomEvent(input, "change", () => {
					this.writeBackCell(el, ctx, rowIndex, colIndex, input.checked ? "[x]" : "[ ]");
				});
				break;
			}
			case "select": {
				const select = activeDocument.createElement("select");
				select.classList.add("tf-select");
				const opts = col.options && col.options.length ? col.options : [raw];
				if (!opts.includes(raw)) opts.unshift(raw); // keep current value selectable
				for (const o of opts) {
					const opt = select.createEl("option", { text: o });
					if (o === raw) opt.selected = true;
				}
				td.textContent = "";
				td.appendChild(select);
				this.registerDomEvent(select, "change", () => {
					this.writeBackCell(el, ctx, rowIndex, colIndex, select.value);
				});
				break;
			}
			case "currency": {
				const formatted = formatCurrency(raw, col.options && col.options[0]);
				if (formatted != null) td.textContent = formatted;
				td.classList.add("tf-cell-right");
				break;
			}
			case "percentage": {
				td.classList.add("tf-cell-right");
				break;
			}
			case "date": {
				const formatted = formatDate(raw);
				if (formatted != null) {
					td.textContent = formatted;
					td.setAttr("title", raw); // keep ISO discoverable on hover
				}
				td.classList.add("tf-cell-date");
				break;
			}
			default:
				break; // text: leave as-is
		}
	}

	/* --- write-back: replace the exact cell in the Markdown source (Q2) --- */

	writeBackCell(el, ctx, rowIndex, colIndex, newValue) {
		const info = ctx.getSectionInfo(el); // fresh lookup — line numbers may have drifted
		if (!info) {
			new Notice("Table Fields: could not locate table source.");
			return;
		}
		// header = lineStart, delimiter = lineStart+1, data rows start at lineStart+2
		const dataLine = info.lineStart + 2 + rowIndex;

		const apply = (lineText) => {
			const { parts, cellOffset } = splitRow(lineText);
			const idx = cellOffset + colIndex;
			if (idx < 0 || idx >= parts.length) return null;
			parts[idx] = " " + escapePipes(newValue) + " ";
			return parts.join("|");
		};

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.file && view.file.path === ctx.sourcePath && view.editor) {
			const editor = view.editor;
			if (dataLine >= editor.lineCount()) return;
			const cur = editor.getLine(dataLine);
			const next = apply(cur);
			if (next != null && next !== cur) editor.setLine(dataLine, next);
			return;
		}

		// fallback: no matching active editor — patch the file on disk safely
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!file) return;
		this.app.vault.process(file, (data) => {
			const lines = data.split("\n");
			if (dataLine >= lines.length) return data;
			const next = apply(lines[dataLine]);
			if (next != null) lines[dataLine] = next;
			return lines.join("\n");
		});
	}

	/* --- command: mark the table under the cursor as a smart table --- */

	markTableAsSmart(editor) {
		const cursor = editor.getCursor();
		let top = cursor.line;
		let bottom = cursor.line;
		const isTableRow = (n) =>
			n >= 0 && n < editor.lineCount() && editor.getLine(n).includes("|");

		if (!isTableRow(cursor.line)) {
			new Notice("Table Fields: place the cursor inside a Markdown table.");
			return;
		}
		while (isTableRow(top - 1)) top--;
		while (isTableRow(bottom + 1)) bottom++;

		const delimiter = editor.getLine(top + 1) || "";
		if (!isDelimiterRow(delimiter)) {
			new Notice("Table Fields: the table under the cursor has no --- line below its header.");
			return;
		}
		const lines = [];
		for (let n = 0; n < editor.lineCount(); n++) lines.push(editor.getLine(n));
		if (resolveTable(lines, top, bottom)) {
			new Notice("Table Fields: this table already has column types.");
			return;
		}

		// Type row inferred from the first data row, every cell prefixed with "__": the
		// table-internal config format (see parseMarkedRows).
		const headerCells = splitRowCells(lines[top]);
		const sampleCells = top + 2 <= bottom ? splitRowCells(lines[top + 2]) : [];
		const types = headerCells.map((_, i) => inferType((sampleCells[i] || "").trim()));
		const typeRow = "| " + types.map(typeCellText).join(" | ") + " |";

		editor.replaceRange("\n" + typeRow, { line: top + 1, ch: delimiter.length });
		new Notice(
			`Table Fields: marked table (${headerCells.length} columns). Edit the type row; ` +
			`add options in rows of __-prefixed cells and - for none, like | - | __Todo |.`
		);
	}
};

/* ------------------------------ helpers for the command ------------------------------ */

function splitRowCells(line) {
	const { parts, cellOffset } = splitRow(line);
	const cells = parts.slice(cellOffset);
	// drop trailing empty from a trailing pipe
	if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
	return cells.map((c) => c.trim());
}

function inferType(sample) {
	if (CHECKBOX_RE.test(sample)) return "box";
	if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) return "date";
	if (/^\d+(\.\d+)?%$/.test(sample)) return "percentage";
	if (/^\d+(\.\d+)?$/.test(sample)) return "currency";
	return "text";
}

/* ============================================================================
 * Live Preview path — CodeMirror 6 editor extension.
 * Replaces each smart table's source lines with an interactive table widget,
 * unless the cursor is inside the table (then show source for editing).
 * Only active in Live Preview (editorLivePreviewField); Source mode stays raw.
 * ==========================================================================*/

// Scan the whole document for smart tables (type rows or a config comment), skipping
// fenced code blocks. Returns, per table, resolveTable()'s result plus the 0-based
// header and last row line indices.
function findSmartTables(text) {
	const lines = text.split("\n");
	const out = [];
	let fence = null;
	for (let i = 0; i < lines.length; i++) {
		const fm = lines[i].match(/^\s*(`{3,}|~{3,})/);
		if (fm) {
			if (fence === null) fence = fm[1][0];
			else if (fm[1][0] === fence) fence = null;
			continue;
		}
		if (fence !== null) continue;
		if (!lines[i].includes("|") || !isDelimiterRow(lines[i + 1])) continue;
		if (i > 0 && lines[i - 1].trim() !== "" && lines[i - 1].includes("|")) continue; // not a header
		const lastRowLine = lastTableRow(lines, i);
		const resolved = resolveTable(lines, i, lastRowLine);
		if (resolved) out.push(Object.assign({ headerLine: i, lastRowLine }, resolved));
		i = lastRowLine; // continue scanning after this table
	}
	return out;
}

// Serialize a config object back into a `<!-- table-fields ... -->` comment block.
function serializeConfig(config) {
	const lines = config.cols.map((c) => {
		let s = `  - {name: "${c.name}", type: "${c.type}"`;
		if (c.options && c.options.length) s += `, options: [${c.options.map((o) => `"${o}"`).join(",")}]`;
		return s + "}";
	});
	return (
		`<!-- table-fields id="${config.id || "table"}" v="${config.version || "1"}"\n` +
		`cols:\n` +
		lines.join("\n") +
		`\n-->`
	);
}

// Split a table row into cell segments with absolute doc offsets (between pipes).
function getCellRanges(lineText, lineFrom) {
	const pipes = findSeparatorPipes(lineText);
	const cells = [];
	for (let k = 0; k < pipes.length - 1; k++) {
		const innerFrom = pipes[k] + 1;
		const innerTo = pipes[k + 1];
		cells.push({ text: lineText.slice(innerFrom, innerTo), from: lineFrom + innerFrom, to: lineFrom + innerTo });
	}
	return cells;
}

// Replace one cell's source range via a CM6 transaction (the write-back, Q2).
function dispatchCell(view, cell, newValue) {
	view.dispatch({ changes: { from: cell.from, to: cell.to, insert: " " + escapePipes(newValue) + " " } });
}

// Render a text cell's Markdown (<br>, links, bold, code, ...) the way a native table
// cell shows it. Without a render context (no app found) it falls back to plain text.
function renderCellMarkdown(td, text, md) {
	if (!md || !text) {
		td.textContent = text;
		return;
	}
	td.classList.add("tf-cell-md");
	renderMarkdownInto(md.app, text, td, md.component, md.sourcePath);
}

// Render a single interactive/formatted cell into `td` for the Live Preview widget.
// `md` is { app, sourcePath, component } for Markdown rendering of text cells, or null.
function renderWidgetCell(td, col, cell, view, md) {
	const raw = unescapePipes((cell.text || "").trim());
	switch (col.type) {
		case "checkbox": {
			if (!CHECKBOX_RE.test(raw)) { td.textContent = raw; return; }
			const input = td.createEl("input", { type: "checkbox" });
			input.checked = isChecked(raw);
			input.classList.add("tf-checkbox");
			td.classList.add("tf-cell-center");
			input.addEventListener("change", () => dispatchCell(view, cell, input.checked ? "[x]" : "[ ]"));
			break;
		}
		case "select": {
			const select = activeDocument.createElement("select");
			select.classList.add("tf-select");
			const opts = col.options && col.options.length ? col.options.slice() : [raw];
			if (!opts.includes(raw)) opts.unshift(raw);
			for (const o of opts) {
				const opt = select.createEl("option", { text: o });
				if (o === raw) opt.selected = true;
			}
			td.appendChild(select);
			select.addEventListener("change", () => dispatchCell(view, cell, select.value));
			break;
		}
		case "currency": {
			const f = formatCurrency(raw, col.options && col.options[0]);
			td.textContent = f != null ? f : raw;
			td.classList.add("tf-cell-right");
			break;
		}
		case "percentage": {
			td.textContent = raw;
			td.classList.add("tf-cell-right");
			break;
		}
		case "date": {
			const f = formatDate(raw);
			td.textContent = f != null ? f : raw;
			if (f != null) td.setAttr("title", raw);
			td.classList.add("tf-cell-date");
			break;
		}
		default:
			renderCellMarkdown(td, raw, md);
	}
}

// Attribute on a widget cell holding the document offset its click moves the cursor to.
const SOURCE_POS_ATTR = "data-tf-pos";

// Attributes on a widget cell locating the same cell in Obsidian's rendered table:
// row -1 is the header, 0.. the body rows in source order (config rows included).
const NATIVE_ROW_ATTR = "data-tf-row";
const NATIVE_COL_ATTR = "data-tf-col";

// Where a click on a cell puts the cursor: at its text, after the padding space.
function cellSourcePos(cell) {
	const lead = (cell.text || "").length - (cell.text || "").trimStart().length;
	return Math.min(cell.from + lead, cell.to);
}

// The document offset a mousedown in the widget should move the cursor to, or null for a
// click that is not a left click or that lands on a checkbox, dropdown, link or button.
function sourcePosOfClick(evt) {
	if (evt.button !== 0) return null;
	const target = evt.target;
	if (!target || !target.closest || target.closest("input, select, a, button")) return null;
	const cell = target.closest("[" + SOURCE_POS_ATTR + "]");
	if (!cell) return null;
	const pos = Number(cell.getAttribute(SOURCE_POS_ATTR));
	return Number.isFinite(pos) ? pos : null;
}

// The block widget that renders a whole smart table interactively in Live Preview.
class SmartTableWidget extends WidgetType {
	constructor(data) {
		super();
		this.data = data;
	}
	eq(other) {
		return other && other.data && other.data.signature === this.data.signature;
	}
	toDOM(view) {
		const wrap = activeDocument.createElement("div");
		wrap.className = "tf-lp-wrap";

		// Render context for Markdown text cells; the component owns the rendered
		// children and is unloaded in destroy().
		const info = view.state.field(editorInfoField, false);
		const app = info && info.app;
		let md = null;
		if (app) {
			const component = new Component();
			component.load();
			wrap.tfComponent = component;
			md = { app, sourcePath: info.file ? info.file.path : "", component };
			// ignoreEvent() keeps the editor from handling clicks, so open internal links here.
			wrap.addEventListener("click", (evt) => {
				const a = evt.target.closest && evt.target.closest("a.internal-link");
				if (!a) return;
				evt.preventDefault();
				const target = a.getAttribute("data-href") || a.getAttribute("href");
				if (target) app.workspace.openLinkText(target, md.sourcePath, Keymap.isModEvent(evt));
			});
		}
		// A left click on a cell (not on a control or link) hands the table to Obsidian's own
		// table editor: the widget steps aside for this table (editedTableField), and the click
		// is repeated on the same cell of Obsidian's table so its cell editor opens there.
		wrap.addEventListener("mousedown", (evt) => {
			const pos = sourcePosOfClick(evt);
			if (pos === null) return;
			evt.preventDefault();
			const cellEl = evt.target.closest("[" + SOURCE_POS_ATTR + "]");
			const nativeRow = Number(cellEl.getAttribute(NATIVE_ROW_ATTR));
			const nativeCol = Number(cellEl.getAttribute(NATIVE_COL_ATTR));
			const range = { from: this.data.from, to: this.data.to, since: Date.now() };
			view.dispatch({ effects: editTable.of(range), selection: { anchor: pos } });
			requestAnimationFrame(() => {
				if (!clickNativeCell(view, range, nativeRow, nativeCol)) {
					console.warn("[tf] click to edit: cell", nativeRow, nativeCol, "not found in Obsidian's table");
				}
			});
		});
		const table = activeDocument.createElement("table");
		table.className = "tf-table tf-lp-table";

		const thead = activeDocument.createElement("thead");
		const htr = activeDocument.createElement("tr");
		const headerCells = this.data.headerCells || [];
		this.data.config.cols.forEach((col, colIndex) => {
			const th = activeDocument.createElement("th");
			th.textContent = col.name;
			th.classList.add("tf-th");
			if (headerCells[colIndex]) th.setAttribute(SOURCE_POS_ATTR, String(cellSourcePos(headerCells[colIndex])));
			th.setAttribute(NATIVE_ROW_ATTR, "-1");
			th.setAttribute(NATIVE_COL_ATTR, String(colIndex));
			th.setAttr("title", "Right-click to set column type");
			th.addEventListener("contextmenu", (evt) => {
				evt.preventDefault();
				this.showColumnMenu(view, colIndex, col, evt);
			});
			htr.appendChild(th);
		});
		thead.appendChild(htr);
		table.appendChild(thead);

		const tbody = activeDocument.createElement("tbody");
		for (const row of this.data.rows) {
			const tr = activeDocument.createElement("tr");
			row.cells.forEach((cell, colIndex) => {
				const col = this.data.config.cols[colIndex];
				const td = activeDocument.createElement("td");
				td.setAttribute(SOURCE_POS_ATTR, String(cellSourcePos(cell)));
				// Obsidian's table shows every source row, config rows included.
				td.setAttribute(NATIVE_ROW_ATTR, String(row.line - (this.data.headerLine + 2)));
				td.setAttribute(NATIVE_COL_ATTR, String(colIndex));
				if (col) renderWidgetCell(td, col, cell, view, md);
				else renderCellMarkdown(td, unescapePipes((cell.text || "").trim()), md);
				tr.appendChild(td);
			});
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		wrap.appendChild(table);
		return wrap;
	}
	destroy(dom) {
		if (dom.tfComponent) dom.tfComponent.unload();
	}
	// Right-click a header -> pick the column's type (rewrites the type cell or the comment).
	showColumnMenu(view, colIndex, col, evt) {
		const menu = new Menu();
		menu.addItem((i) => i.setTitle("Column: " + col.name).setDisabled(true));
		menu.addSeparator();
		const types = ["text", "box", "select", "date", "currency", "percentage"];
		for (const ty of types) {
			menu.addItem((item) => {
				item
					.setTitle(ty)
					.setChecked(col.type === fieldType(ty))
					.onClick(() => {
						if (this.data.typeCells) {
							const cell = this.data.typeCells[colIndex];
							if (cell) dispatchCell(view, cell, this.data.typeMark ? typeCellText(ty) : ty);
							return;
						}
						// The comment format keeps the long name the original plugin reads.
						const cols = this.data.config.cols.map((c, i) =>
							i === colIndex ? Object.assign({}, c, { type: fieldType(ty) }) : c
						);
						const cfg = { id: this.data.config.id, version: this.data.config.version, cols };
						view.dispatch({
							changes: { from: this.data.configRange.from, to: this.data.configRange.to, insert: serializeConfig(cfg) },
						});
					});
			});
		}
		menu.showAtMouseEvent(evt);
	}

	// Let our controls handle their own events instead of the editor.
	ignoreEvent() {
		return true;
	}
}

// Build the decoration set for the current editor state.
function buildSmartTableDecorations(state) {
	try {
		if (!state.field(editorLivePreviewField, false)) return Decoration.none; // Source mode -> raw
		const text = state.doc.toString();
		const tables = findSmartTables(text);
		if (!tables.length) return Decoration.none;
		const sel = state.selection.main;
		const editedValue = state.field(editedTableField, false);
		const edited = editedValue && typeof editedValue === "object" ? editedValue : null;
		const builder = new RangeSetBuilder();
		for (const t of tables) {
			// Replace the table, type rows included; a config comment above stays visible.
			const fromLine = state.doc.line(t.headerLine + 1);
			const toLine = state.doc.line(t.lastRowLine + 1);
			const from = fromLine.from;
			const to = toLine.to;
			if (sel.to >= from && sel.from <= to) continue; // cursor inside table -> show source
			if (edited && edited.from <= to && edited.to >= from) continue; // handed to Obsidian's table editor

			const rows = [];
			const sigParts = [];
			const configLines = new Set(t.configLines);
			for (let ln = t.headerLine + 2; ln <= t.lastRowLine; ln++) {
				if (configLines.has(ln)) continue; // type, option and end rows are not data
				const line = state.doc.line(ln + 1);
				const cells = getCellRanges(line.text, line.from);
				rows.push({ cells, line: ln });
				sigParts.push(cells.map((c) => c.text).join("|"));
			}
			const signature =
				from + ":" + to + ":" + t.config.cols.map((c) => c.name + "/" + c.type + "/" + (c.options || []).join(".")).join(",") + ":" + sigParts.join("//");
			// Where a column type change is written: the comment, or the type row's cells.
			const configRange = t.comment
				? { from: state.doc.line(t.comment.start + 1).from, to: state.doc.line(t.comment.end + 1).to }
				: null;
			let typeCells = null;
			if (t.typeLine !== null) {
				const typeRow = state.doc.line(t.typeLine + 1);
				typeCells = getCellRanges(typeRow.text, typeRow.from);
			}
			const typeMark = t.marked ? CONFIG_MARK : "";
			const headerCells = getCellRanges(fromLine.text, fromLine.from);
			const widget = new SmartTableWidget({
				config: t.config, rows, signature, configRange, typeCells, typeMark, headerCells, from, to, headerLine: t.headerLine,
			});
			builder.add(from, to, Decoration.replace({ widget, block: true }));
		}
		return builder.finish();
	} catch (e) {
		console.error("[tf] LP buildDecorations error:", e);
		return Decoration.none;
	}
}

const smartTableField = StateField.define({
	create(state) {
		return buildSmartTableDecorations(state);
	},
	update(deco, tr) {
		// Also rebuild when Live Preview is switched on/off (Obsidian does that after the
		// editor is created), or the table only appears once the cursor moves.
		const modeChanged =
			tr.startState.field(editorLivePreviewField, false) !== tr.state.field(editorLivePreviewField, false);
		const editChanged = (tr.effects || []).some((e) => e.is && e.is(editTable));
		if (!tr.docChanged && !tr.selection && !modeChanged && !tr.reconfigured && !editChanged) return deco;
		return buildSmartTableDecorations(tr.state);
	},
	provide(f) {
		return EditorView.decorations.from(f);
	},
});

/* --- click to edit: hand a table to Obsidian's table editor and take it back after --- */

// Sets the table being edited in Obsidian's table editor ({ from, to, since }) or null.
const editTable = StateEffect.define();

// The table the widget stepped aside for, its range mapped through edits; null if none.
const editedTableField = StateField.define({
	create() {
		return null;
	},
	update(value, tr) {
		let next = value && tr.docChanged
			? { from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1), since: value.since }
			: value;
		for (const e of tr.effects || []) {
			if (e.is && e.is(editTable)) next = e.value;
		}
		return next;
	},
});

// Whether the edited table should get its widget back: the edit started a moment ago at the
// earliest, the cursor is outside the table source, and the focus is not in one of
// Obsidian's cell editors of that table.
function shouldResumeTable(edited, head, now, focusInTable) {
	if (!edited) return false;
	if (now - edited.since < 500) return false;
	if (head >= edited.from && head <= edited.to) return false;
	return !focusInTable;
}

// Obsidian's own rendered table for the table source in range, or null.
function nativeTableElement(view, range) {
	for (const el of view.dom.querySelectorAll(".cm-table-widget, .cm-embed-block")) {
		let pos;
		try {
			pos = view.posAtDOM(el);
		} catch (e) {
			continue;
		}
		if (pos >= range.from && pos <= range.to && el.querySelector("table")) return el;
	}
	return null;
}

// Repeats a left click on cell (row, col) of Obsidian's table for range: row -1 is the
// header row, 0.. the body rows in source order. Returns whether the cell was found.
function clickNativeCell(view, range, row, col) {
	const widget = nativeTableElement(view, range);
	const table = widget && widget.querySelector("table");
	if (!table) return false;
	const tr = row < 0 ? table.tHead && table.tHead.rows[0] : table.tBodies[0] && table.tBodies[0].rows[row];
	const cell = tr && tr.cells[col];
	if (!cell) return false;
	const target = cell.querySelector(".table-cell-wrapper") || cell;
	const box = target.getBoundingClientRect();
	const win = cell.ownerDocument.defaultView;
	const init = {
		bubbles: true, cancelable: true, composed: true, view: win, detail: 1, button: 0, buttons: 1,
		clientX: box.left + Math.min(8, box.width / 2), clientY: box.top + box.height / 2,
		pointerId: 1, pointerType: "mouse", isPrimary: true,
	};
	// Obsidian opens its cell editor on pointer events, so send those along with mouse events.
	target.dispatchEvent(new win.PointerEvent("pointerdown", init));
	target.dispatchEvent(new win.MouseEvent("mousedown", init));
	target.dispatchEvent(new win.PointerEvent("pointerup", Object.assign({}, init, { buttons: 0 })));
	target.dispatchEvent(new win.MouseEvent("mouseup", Object.assign({}, init, { buttons: 0 })));
	target.dispatchEvent(new win.MouseEvent("click", Object.assign({}, init, { buttons: 0 })));
	// If a cell editor opened but did not take the focus, give it the focus at its end.
	setTimeout(() => {
		const editable = cell.querySelector("[contenteditable='true']");
		if (editable && !editable.contains(cell.ownerDocument.activeElement)) {
			editable.focus();
			const sel = win.getSelection();
			if (sel) {
				sel.selectAllChildren(editable);
				sel.collapseToEnd();
			}
		}
	}, 60);
	return true;
}

// Gives the edited table its widget back once the user has left it (shouldResumeTable).
const resumeTablePlugin = ViewPlugin.fromClass(
	class {
		constructor(view) {
			this.view = view;
			this.onFocus = () => this.schedule();
			view.dom.ownerDocument.addEventListener("focusin", this.onFocus);
		}
		update(u) {
			if (u.selectionSet || u.focusChanged || u.docChanged) this.schedule();
		}
		schedule() {
			clearTimeout(this.timer);
			this.timer = setTimeout(() => this.check(), 50);
		}
		check() {
			const edited = this.view.state.field(editedTableField, false);
			if (!edited) return;
			const native = nativeTableElement(this.view, edited);
			const active = this.view.dom.ownerDocument.activeElement;
			const focusInTable = !!(native && active && native.contains(active));
			const head = this.view.state.selection.main.head;
			if (shouldResumeTable(edited, head, Date.now(), focusInTable)) {
				this.view.dispatch({ effects: editTable.of(null) });
			} else if (Date.now() - edited.since < 500) {
				this.schedule();
			}
		}
		destroy() {
			clearTimeout(this.timer);
			this.view.dom.ownerDocument.removeEventListener("focusin", this.onFocus);
		}
	}
);

/* ============================================================================
 * Settings tab — two sub-tabs: "Usage guide" and "AI skill" (copy-paste).
 * ==========================================================================*/

function buildUsageMd(img) {
	return [
	"# Table Fields",
	"",
	"Plain Markdown tables you can click: checkboxes, dropdowns, and tidy dates, money, and",
	"percentages — all inside your note. It stays a normal table underneath.",
	"",
	"![Dropdown, date, money, and checkbox fields render right in the note.](" + img("01-dropdown-field.png") + ")",
	"",
	"## What it does",
	"",
	"- **Checkboxes you can tick** — click to mark something done, right in the table.",
	"- **Dropdowns** — pick a status or category from a fixed list, so values never drift.",
	"- **Money, %, and dates that look right** — amounts line up with a currency symbol, dates read",
	"  in your local format, percentages align neatly.",
	"- **Right-click a column header** to set what it is — no config screen to hunt through.",
	"- **Works while you read *and* while you edit.**",
	"- **Nothing locked in** — it is always a plain Markdown table on disk.",
	"",
	"## Set up a table",
	"",
	"Below the header's --- line, add a row with each column's type, then one row per dropdown",
	"option (or currency code). Start their cells with __ and put a - in the option cells without",
	"an option:",
	"",
	"    | Task      | Status   | Due        | Done  |",
	"    | --------- | -------- | ---------- | ----- |",
	"    | __text    | __select | __date     | __    |",
	"    | -         | __Todo   | -          | -     |",
	"    | -         | __Doing  | -          | -     |",
	"    | -         | __Done   | -          | -     |",
	"    | Draft PRD | Doing    | 2026-07-22 | [x]   |",
	"",
	"An empty type cell means text, a lone __ means a checkbox (box). The plugin hides these rows",
	"when it shows the table, and finds them wherever sorting the table by a column moves them.",
	"Sorting ascending keeps the type row first and the option rows right below it.",
	"",
	"Or: put your cursor in any normal table and run the command **Table Fields: Mark table under",
	"cursor as Table Fields** — it adds the type row from your data. Then right-click a header to",
	"change a type.",
	"",
	"Tables set up with the older config comment above the table keep working.",
	"",
	"![Right-click a column header to choose its field type.](" + img("02-field-type-menu.png") + ")",
	"",
	"## Field types",
	"",
	"- **text** — plain text.",
	"- **box** (or **checkbox**) — stored as [x] or [ ], shown as a clickable box.",
	"- **select** — a dropdown; the choices come from the column's options list.",
	"- **date** — stored as YYYY-MM-DD, shown in your local date style.",
	"- **currency** — a plain number (e.g. 1200.00); the symbol comes from options (e.g. USD).",
	"- **percentage** — kept as simple NN% text, right-aligned.",
	"",
	"![Ticking a checkbox writes the value straight back to the Markdown table.](" + img("03-checkbox-field.png") + ")",
	"",
	"## Good to know",
	"",
	"- Your values stay plain, readable text; the pretty formatting is only on screen.",
	"- There are no formulas — this is on purpose.",
	"- Turn the plugin off and every table is still plain Markdown; the type and option rows then",
	"  show as ordinary rows.",
	"",
	"![With the plugin off, the note is still a clean Markdown table.](" + img("04-markdown-fallback.png") + ")",
	].join("\n");
}

const SKILL_TEXT = [
	"You are assisting a user who uses the Table Fields plugin for Obsidian. Table Fields adds typed,",
	"interactive columns (checkbox, dropdown, date, currency, percentage) to PLAIN Markdown tables,",
	"using config rows inside each table. The table on disk stays a GFM pipe table.",
	"Help the user read, create, and edit these tables while following the syntax and storage rules",
	"below. Never add formulas and never convert a table into a database or JSON.",
	"",
	"THE CONFIG ROWS",
	"Config rows are rows whose cells each start with __, are a single - or are empty (at least one",
	"starts with __). They usually follow the header's --- row, but sorting the table may move them:",
	"",
	"    | Task   | Status   | Due    | Amount     | Done  |",
	"    | ----   | ------   | ----   | --------   | ----  |",
	"    | __text | __select | __date | __currency | __    |",
	"    | -      | __Todo   | -      | __USD      | -     |",
	"    | -      | __Doing  | -      | -          | -     |",
	"    | -      | __Done   | -      | -          | -     |",
	"    | ...    | ...      | ...    | ...        | ...   |",
	"",
	"- Type row: the config row of type names, one per column: text, box, select, date, currency,",
	"  percentage. An empty cell means text, a lone __ means box; checkbox is an alias of box.",
	"- Option rows: the other config rows, one option per row and column. For select, the allowed",
	"  values; for currency, a single ISO currency code such as USD. Write a single - in a cell",
	"  without an option, so an ascending sort keeps the option rows right below the type row",
	"  (older tables leave such cells empty). Write a | inside an option as \\|.",
	"- All other rows are data rows. Never add a second --- row: Obsidian deletes it.",
	"Older tables may have the type and option rows unprefixed right after the --- row, ended by a",
	"row of === or ---, or an HTML comment above the table (<!-- table-fields ... cols: ... -->)",
	"listing {name, type, options} per column in column order; read them the same way.",
	"",
	"HOW VALUES ARE STORED (use these exact forms when writing cells)",
	"- text: plain text. Example: Draft PRD",
	"- box: [x] for checked, [ ] for unchecked.",
	"- select: the exact option text. Example: Doing",
	"- date: ISO date YYYY-MM-DD. Example: 2026-07-22",
	"- currency: a plain number, no symbol or commas. Example: 1200.50",
	"- percentage: a number followed by a percent sign. Example: 60%",
	"Values are stored in this plain, canonical form; the plugin only formats them on screen.",
	"",
	"RULES",
	"1. Keep it a valid GFM pipe table: a header row, a --- delimiter row, the config rows, then data",
	"   rows. Every row starts and ends with a pipe and has the same number of cells as there are columns.",
	"2. In type and option rows, start every cell with __, except empty type cells and - option",
	"   cells. A data row must have at least one cell that is neither empty, - nor starts with __.",
	"3. Do not invent formulas or computed cells. Percentages and currency are literal values.",
	"4. For select cells, only use values listed in that column's option rows. If a new value is",
	"   needed, add it as an option too (add an option row if the column has no free cell left).",
	"5. For box cells, only use [x] or [ ].",
	"6. For dates, always write ISO YYYY-MM-DD in the source (the plugin displays them localized).",
	"7. For currency, store the number only (e.g. 59.00); the symbol comes from the column's option.",
	"8. Preserve the user's other columns and rows; do not reorder columns unless asked.",
	"",
	"READING A TABLE",
	"Read the config rows to learn each column's type, then interpret the data cells: [x] means",
	"done/true, a currency number is money in that column's currency, 60% means sixty percent, a",
	"select value is one of the allowed options. Use these meanings to summarize, filter, or answer.",
	"",
	"CREATING OR EDITING A TABLE",
	"- Create: write the header row, ---, the __type row, any __option rows, then the data rows,",
	"  using the storage forms above.",
	"- Edit a value: change only the target cell, keeping its canonical form.",
	"- Add a column: add a cell to every row - header, --- row, type and option rows and data rows.",
	"- Add a data row: add one pipe row after the config rows with a value per column in canonical form.",
	"- Change a column's type: update its cell in the type row (keeping the __, and its options if",
	"  needed), and make sure existing cell values match the new type's storage form.",
	"",
	"EXAMPLE",
	"User: \"Mark 'Draft PRD' as done and add a Priority column with Low/Medium/High.\"",
	"You: set that row's Done cell to [x]; add a Priority column whose type cell is __select and whose",
	"option cells are __Low, __Medium and __High (adding option rows if needed), with --- in the",
	"delimiter row, - in its cells of the other option rows and a value such as High in every data row.",
].join("\n");

async function renderMarkdownInto(app, md, el, component, sourcePath = "") {
	try {
		if (MarkdownRenderer && typeof MarkdownRenderer.render === "function") {
			await MarkdownRenderer.render(app, md, el, sourcePath, component);
		} else if (MarkdownRenderer && typeof MarkdownRenderer.renderMarkdown === "function") {
			await MarkdownRenderer.renderMarkdown(md, el, sourcePath, component);
		} else {
			el.setText(md);
		}
	} catch (e) {
		el.setText(md);
	}
}

class TableFieldsSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.activeTab = "usage";
		this.previewComponent = null;
	}

	hide() {
		if (this.previewComponent) {
			this.previewComponent.unload();
			this.previewComponent = null;
		}
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("tf-settings");

		const tabbar = containerEl.createDiv({ cls: "tf-tabbar" });
		const body = containerEl.createDiv({ cls: "tf-tabbody" });

		const buttons = {};
		const show = (key) => {
			this.activeTab = key;
			for (const k in buttons) buttons[k].toggleClass("tf-tab-active", k === key);
			body.empty();
			if (key === "skill") this.renderSkill(body);
			else this.renderUsage(body);
		};
		const defs = [
			{ key: "usage", label: "Usage guide" },
			{ key: "skill", label: "AI skill" },
		];
		for (const d of defs) {
			const btn = tabbar.createEl("button", { text: d.label, cls: "tf-tab" });
			buttons[d.key] = btn;
			btn.onclick = () => show(d.key);
		}
		show(this.activeTab);
	}

	renderUsage(el) {
		const md = el.createDiv({ cls: "tf-usage markdown-rendered" });
		const dir = (this.plugin.manifest && this.plugin.manifest.dir) || ".obsidian/plugins/table-fields";
		const img = (file) => {
			try {
				return this.app.vault.adapter.getResourcePath(dir + "/assets/readme/" + file);
			} catch (e) {
				return "";
			}
		};
		if (this.previewComponent) this.previewComponent.unload();
		this.previewComponent = new Component();
		this.previewComponent.load();
		renderMarkdownInto(this.app, buildUsageMd(img), md, this.previewComponent);
	}

	renderSkill(el) {
		el.createEl("p", {
			cls: "tf-skill-desc",
			text:
				"Copy this and paste it into your AI assistant (Claude, ChatGPT, etc.) so it understands " +
				"Table Fields and can read or edit your tables for you.",
		});
		const bar = el.createDiv({ cls: "tf-skill-bar" });
		const copyBtn = bar.createEl("button", { text: "Copy to clipboard", cls: "mod-cta" });
		const ta = el.createEl("textarea", { cls: "tf-skill-text" });
		ta.value = SKILL_TEXT;
		ta.readOnly = true;
		ta.spellcheck = false;
		ta.setAttr("rows", "22");
		copyBtn.onclick = () => {
			void (async () => {
				try {
					await navigator.clipboard.writeText(SKILL_TEXT);
					new Notice("Copied Table Fields AI skill to clipboard");
				} catch (e) {
					ta.select();
					new Notice("Press Ctrl/Cmd-C to copy the selected text");
				}
			})();
		};
	}
}
