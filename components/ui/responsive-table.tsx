import type { ReactNode } from "react";

export type Column<Row> = {
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "right";
  // Extra classes for the cell, for example `whitespace-nowrap`.
  className?: string;
};

// The dashboard's list shape (extracted in T29b from Orders, Pickups and the
// roster): a bordered table from 768px, the same rows as cards below it. Each
// card is the caller's, since phones show a row's facts in a different order.
export function ResponsiveTable<Row>({
  label,
  rows,
  rowKey,
  columns,
  card,
  minWidth = 820
}: {
  label: string;
  rows: Row[];
  rowKey: (row: Row) => string;
  columns: Column<Row>[];
  card: (row: Row) => ReactNode;
  minWidth?: number;
}) {
  const edge = (index: number) => (index === 0 ? "pl-5 pr-3" : index === columns.length - 1 ? "pl-3 pr-5" : "px-3");
  return (
    <>
      {/* Focusable so keyboard users can scroll a wide table sideways (T40). */}
      <div aria-label={label} className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block" role="region" tabIndex={0}>
        <table aria-label={label} className="w-full border-collapse text-left text-ui" style={{ minWidth }}>
          <thead>
            <tr className="text-caption text-ink-soft">
              {columns.map((column, index) => (
                <th className={`${edge(index)} py-3.5 font-semibold ${column.align === "right" ? "text-right" : ""}`} key={column.header} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t border-line align-top" key={rowKey(row)}>
                {columns.map((column, index) => (
                  <td className={`${edge(index)} py-3.5 ${column.align === "right" ? "text-right tabular-nums" : ""} ${column.className ?? ""}`} key={column.header}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={label} className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <li className="grid gap-1.5 rounded-card border border-line bg-surface p-4" key={rowKey(row)}>
            {card(row)}
          </li>
        ))}
      </ul>
    </>
  );
}
