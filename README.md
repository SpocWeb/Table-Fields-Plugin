# Table Fields

> Your Markdown tables, but you can actually **click** them — tick checkboxes, pick from
> dropdowns, and see dates and money formatted nicely — all inside your note.

**English** · [中文](README.zh-CN.md) — [Engineering ›](ENGINEERING.md)

Table Fields gives each **column a meaning**. Tell it "this column is a checkbox", "this one is a
status dropdown", "this one is money" — and your plain table turns into something you can operate
like a tiny spreadsheet. And here's the promise: **underneath, it's still just a normal Markdown
table.** Turn the plugin off and your note is exactly as readable as before. No database, no hidden
file, no lock-in.

## Dropdown, date, money, and checkbox fields render in the note

![Dropdown fields keep table values consistent while dates, currency, and checkboxes stay readable.](assets/readme/01-dropdown-field.png)

- ☑️ **Checkboxes you can tick** — click to mark something done, right in the table.
- 🔽 **Dropdowns** — pick a status or category from a fixed list, so values never drift.
- 💲 **Money, %, and dates that look right** — amounts line up with a currency symbol, dates read in
  your local format, percentages align neatly.
- 🖱️ **Right-click a column to set what it is or sort by it** — no settings screen to hunt through.
- 👀 **Works while you read *and* while you edit** — the controls show up in both modes.
- 🧹 **Nothing locked in** — it's always a plain Markdown table on disk.

## A type row or a comment gives each column its field type

You can describe the columns in one of two ways. Both give the same result, and the plugin reads
either one.

### Option 1: `__` type rows inside the table

Below the header's `---` line you write a row with each column's type 
and one row per dropdown option. 
These cells need to start with `__`, 
which is how the plugin finds them, even after you sort the table by a column.
An option cell without an option holds a single `-`. 
When you sort ascending, the `__` cells come first and the `-` cells next, 
so the type row stays at the top and the option rows right below it. 
The data rows follow:

```markdown
| Task           | Status   | Due        | Done  |
| -------------- | -------- | ---------- | ----- |
| __text         | __select | __date     | __    |
| -              | __Todo   | -          | -     |
| -              | __Doing  | -          | -     |
| -              | __Done   | -          | -     |
| Draft PRD      | Doing    | 2026-07-22 | [x]   |
| Review designs | Todo     | 2026-07-24 | [ ]   |
```

The plugin hides the type and option rows; without the plugin they show as ordinary rows. This is
the format the plugin writes when you mark a table or change a column's type.

### Option 2: an HTML comment above the table

You write (or generate) a small comment like this. Leave one empty line between the comment and the
table, otherwise Obsidian does not render the table:

```markdown
<!-- table-fields id="tasks" v="1"
cols:
  - {name: "Task",   type: "text"}
  - {name: "Status", type: "select", options: ["Todo","Doing","Done"]}
  - {name: "Due",    type: "date"}
  - {name: "Done",   type: "box"}
-->

| Task           | Status | Due        | Done |
| -------------- | ------ | ---------- | ---- |
| Draft PRD      | Doing  | 2026-07-22 | [x]  |
| Review designs | Todo   | 2026-07-24 | [ ]  |
```

The comment is invisible in Reading view and keeps the table itself free of extra rows.

Either way, in your note it becomes a table where **Status** is a dropdown, **Due** shows a tidy
date, and **Done** is a real checkbox you can click. Tick it, and the change is saved straight into
the table.

### Checkbox columns have several spellings

A checkbox column can be written as `box` or as `checkbox`; both mean the same. In a type row a lone
`__` is the short form of `__box`, so `__`, `__box` and `__checkbox` are equivalent. An empty cell
in the type row means `text`.

![Right-click a column header to choose its Table Fields type.](assets/readme/02-field-type-menu.png)

## Dropdown choices are edited in Source mode

Switch the note to **Source mode** and edit the choices of the `select` column. With type rows, each
choice is a `__`-prefixed cell in that column's option rows, for example `__Low`, `__Medium`,
`__High`; add an option row if the column needs more choices than there are rows, with `-` in the
other columns. Tables written with empty option cells keep working. With a comment,
edit the column's `options` list, for example `options: ["Low","Medium","High"]`. When you switch
back to Reading view or Live Preview, the dropdown uses the new choices. Tip: if they do not appear
immediately, leave the note and open it again to refresh the rendered dropdown.

![Edit dropdown choices in Source mode by changing the select column's options list.](assets/readme/05-edit-dropdown-options.png)

## Checkbox clicks write back to the Markdown table

![Checkbox fields can be ticked directly from the table, with the value saved back to Markdown.](assets/readme/03-checkbox-field.png)

## Turning the plugin off leaves a readable Markdown table

- **It's not a database.** Tools like Obsidian Bases turn every row into a separate note. Table
  Fields keeps everything in *one table in one note*.
- **It's not a separate spreadsheet.** Other table tools store your data as a block of code you can
  no longer read. Table Fields never does that — it stays a plain table.
- **Disable it anytime.** Your note is still a clean, readable Markdown table. You never lose your
  data or your ability to read it in any other app.

![With Table Fields disabled, the note is still a Markdown table; display-only formatting such as the US$ currency prefix falls back to the stored plain number.](assets/readme/04-markdown-fallback.png)

## Mark any ordinary Markdown table to start

1. Write a normal Markdown table.
2. Put your cursor in it and run the command **"Table Fields: Mark table under cursor as Table
   Fields"** — it looks at your data and sets up the columns for you.
3. Want to change a column? **Right-click its header** and pick the type (text, box (checkbox), dropdown,
   date, money, or percent).
4. Want to sort? The same menu has **Sort ascending** and **Sort descending**. The type and option
   rows stay at the top; the data rows are ordered by the column's type (numbers by value, dates
   by date, unchecked boxes before checked ones, dropdown values in the order of their options),
   and empty cells go last.

That's it. Click your checkboxes and dropdowns; everything saves back into the note automatically.

## Each field type keeps one kind of value tidy

- **Checkbox columns** — turn a column of `done / not done` into clickable boxes.
- **Dropdown (select) columns** — give a column a fixed set of choices (like *Todo / Doing / Done*)
  so everyone uses the same words.
- **Money columns** — type a plain number; it's shown with a currency symbol and lined up on the
  right.
- **Percent columns** — kept as simple `60%` text, aligned for easy scanning.
- **Date columns** — stored in a standard form, shown in your local date style.
- **Right-click setup** — change any column's type or sort by it from the table itself, no config
  screen needed.

## Let your AI read and edit your tables

Table Fields ships a ready-made prompt for your AI. Open **Settings → Table Fields → AI skill** and
hit **Copy to clipboard**, then paste it into Claude, ChatGPT, or any assistant — now it understands
the Table Fields syntax and can read, create, and edit your tables for you.

![The AI skill tab in Table Fields settings, with a Copy to clipboard button and the ready-made prompt.](assets/readme/06-ai-skill-in-settings.png)

## Privacy & payment

**Free, and fully local.** Table Fields only reads and writes the tables in your own notes — nothing
is sent off your device, there are no accounts or API keys, and the developer collects nothing. See
**[PRIVACY.md](PRIVACY.md)** for the full data-flow.

---

Curious how it works under the hood? See the **[Engineering README ›](ENGINEERING.md)**.
