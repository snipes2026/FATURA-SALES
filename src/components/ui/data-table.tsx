"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
};

/**
 * Searchable table with sticky header, hover rows and a row-actions column.
 * Search is client-side over `searchText(row)` — fine for master lists.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = "Search…",
  toolbar,
  rowActions,
  onRowClick,
  empty = "No records yet.",
  rowClassName,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  rowActions?: (row: T) => React.ReactNode;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  rowClassName?: (row: T) => string | undefined;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term || !searchText) return rows;
    return rows.filter((r) => searchText(r).toLowerCase().includes(term));
  }, [rows, q, searchText]);

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        {searchText && (
          <label className="relative w-full max-w-xs">
            <span className="sr-only">Search</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full rounded-md border border-border pl-8 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
        )}
        <span className="text-xs text-muted">
          {filtered.length} of {rows.length}
        </span>
        <div className="ml-auto flex items-center gap-2">{toolbar}</div>
      </div>
      <div className="max-h-[calc(100vh-260px)] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap border-b border-border px-3 py-2 font-medium",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
              {rowActions && <th className="w-px border-b border-border px-3 py-2" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (rowActions ? 1 : 0)} className="px-3 py-10 text-center text-muted">
                  {rows.length === 0 ? empty : "No matches."}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn("border-b border-border last:border-0 hover:bg-slate-50", onRowClick && "cursor-pointer", rowClassName?.(row))}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-3 py-2",
                        c.align === "right" ? "num" : c.align === "center" ? "text-center" : "text-left",
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="whitespace-nowrap px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                      {rowActions(row)}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
