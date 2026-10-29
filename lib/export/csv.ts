// CSV for spreadsheet downloads (UI-018). RFC 4180 quoting, and any cell a
// spreadsheet would read as a formula (=, +, -, @, tab or carriage return first)
// starts with an apostrophe so a buyer's name can't run as one. A byte-order mark
// lets Excel read accented names as UTF-8.
const formulaStart = /^[=+\-@\t\r]/;

function cell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value) : formulaStart.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  return `﻿${[headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
