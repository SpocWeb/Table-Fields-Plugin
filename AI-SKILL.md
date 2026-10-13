# Table Fields — AI companion skill

Paste the text below into your AI assistant (Claude, ChatGPT, Copilot, etc.) so it understands the
**Table Fields** syntax and can read, create, and edit your tables for you. This same text is
available inside the plugin: **Settings → Table Fields → AI skill → Copy to clipboard**.

---

You are assisting a user who uses the Table Fields plugin for Obsidian. Table Fields adds typed,
interactive columns (checkbox, dropdown, date, currency, percentage) to **plain Markdown tables**,
using a type row and option rows inside each table. The table on disk stays a GFM pipe table.
Help the user read, create, and edit these tables while following the syntax and storage rules
below. Never add formulas and never convert a table into a database or JSON.

### The type section

Between the header's `---` delimiter row and a second `---` delimiter row, a Table Fields table has:

```markdown
| Task | Status | Due  | Amount   | Done |
| ---- | ------ | ---- | -------- | ---- |
| text | select | date | currency | box  |
|      | Todo   |      | USD      |      |
|      | Doing  |      |          |      |
|      | Done   |      |          |      |
| ---- | ------ | ---- | -------- | ---- |
| ...  | ...    | ...  | ...      | ...  |
```

- **Type row** (first row after the header's `---`): one type per column, one of `text`,
  `box`, `select`, `date`, `currency`, `percentage`. An empty cell means `text`; `checkbox` is an
  alias of `box`.
- **Option rows** (zero or more, before the second `---`): one option per row and column. For
  `select`, the allowed values; for `currency`, a single ISO currency code such as `USD`. Leave
  cells empty where a column has fewer options. Write a `|` inside an option as `\|`.
- **Data rows** follow the second `---`.

Older tables may instead have an HTML comment above the table
(`<!-- table-fields ... cols: ... -->`) listing `{name, type, options}` per column in column order;
read it the same way.

### How values are stored (use these exact forms)

| type | stored in the cell as | example |
| --- | --- | --- |
| text | plain text | `Draft PRD` |
| box | `[x]` (checked) or `[ ]` (unchecked) | `[x]` |
| select | the exact option text | `Doing` |
| date | ISO `YYYY-MM-DD` | `2026-07-22` |
| currency | a plain number, no symbol/commas | `1200.50` |
| percentage | a number followed by `%` | `60%` |

Values are stored in this plain, canonical form; the plugin only formats them on screen.

### Rules

1. Keep it a valid GFM pipe table: header row, a `---` delimiter row, the type section, then data
   rows. Every row starts and ends with `|` and has the same number of cells as there are columns.
2. Keep the type row directly after the first `---` row and end the option rows with a second
   `---` row; never put data rows inside the type section.
3. No formulas or computed cells. Percentages and currency are literal values the user maintains.
4. For `select` cells, only use values listed in that column's option rows; if a new value is
   needed, add it as an option too (add an option row if the column has no free cell left).
5. For `box` cells, only use `[x]` or `[ ]`.
6. For dates, always write ISO `YYYY-MM-DD` in the source (the plugin displays them localized).
7. For currency, store the number only (e.g. `59.00`); the symbol comes from the column's option.
8. Preserve the user's other columns and rows; don't reorder columns unless asked.

### Reading a table

Read the type section to learn each column's type, then interpret the data cells: `[x]` means
done/true, a currency number is money in that column's currency, `60%` means sixty percent, a
`select` value is one of the allowed options. Use these meanings to summarize, filter, or answer.

### Creating or editing a table

- **Create**: write the header row, `---`, the type row, any option rows, a second `---`, then the
  data rows, using the storage forms above.
- **Edit a value**: change only the target cell, keeping its canonical form.
- **Add a column**: add a cell to every row - header, both `---` rows, type row, option rows and
  data rows.
- **Add a data row**: add one pipe row after the second `---` with a value per column in
  canonical form.
- **Change a column's type**: update its cell in the type row (and its options if needed), and
  make sure existing cell values match the new type's storage form.

### Example

> "Mark 'Draft PRD' as done and add a Priority column with Low/Medium/High."

Set that row's Done cell to `[x]`; add a `Priority` column whose type cell is `select` and whose
option cells are `Low`, `Medium` and `High` (adding option rows if needed), with `---` in both
delimiter rows and a value such as `High` in every data row.
