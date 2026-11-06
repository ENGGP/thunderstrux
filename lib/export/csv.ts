// CSV for spreadsheet downloads (UI-018). RFC 4180 quoting, and any cell a
// spreadsheet would read as a formula (=, +, -, @, tab or carriage return first)
// starts with an apostrophe so a buyer's name can't run as one. A byte-order mark
// lets Excel read accented names as UTF-8.
// SEC-056: leading spaces and full-width signs still start a formula in some spreadsheets,
// and a reader that splits on semicolons or tabs can start one inside a cell, so those are
// defused and quoted too. SEC-067: so is a formula on a later line of the cell (a reader that
// ignores RFC 4180 quoting starts a row there), and one behind zero-width characters.
// SEC-084: a reader that splits a cell starts a new one after the separator, so the apostrophe
// goes right before each formula sign that follows a comma, semicolon, tab or line break, and
// any invisible format character (\p{Cf}) before a sign is skipped like a space.
const formulaStart = /^[\s\p{Cf}]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r]/u;
const formulaInside = /([,;\t\r\n][\s\p{Cf}]*)(?=[=+\-@\uFF1D\uFF0B\uFF0D\uFF20])/gu;

function cell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value) : (formulaStart.test(value) ? `'${value}` : value).replace(formulaInside, "$1'");
  return /[",;\t\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  return `﻿${[headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
