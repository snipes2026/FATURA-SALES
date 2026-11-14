"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { BalanceText } from "@/components/customers/balance-text";
import { cn } from "@/lib/utils";
import { searchCustomersAction } from "../actions";
import type { CustomerHit } from "../_lib/queries";

export type CustomerPickerHandle = { focus: () => void };

/**
 * Customer search by name / phone / GSTIN (server-side, debounced).
 * ↑/↓ to move, Enter to pick, Esc to close. "+ Add Customer" passes the typed text on.
 */
export const CustomerPicker = forwardRef<
  CustomerPickerHandle,
  { onPick: (c: CustomerHit) => void; onAdd?: (typed: string) => void; selectedLabel: string }
>(function CustomerPicker({ onPick, onAdd, selectedLabel }, ref) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  useEffect(() => {
    if (!open) return;
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await searchCustomersAction({ q: query ?? "" });
      if (my !== seq.current) return;
      setLoading(false);
      setHits(r.ok && r.data ? r.data : []);
      setActive(0);
    }, 180);
    return () => clearTimeout(t);
  }, [query, open]);

  const close = () => {
    setOpen(false);
    setQuery(null);
  };
  const pick = (c: CustomerHit) => {
    onPick(c);
    close();
  };
  const addCount = onAdd ? 1 : 0;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, hits.length - 1 + addCount));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (active < hits.length) pick(hits[active]);
      else if (onAdd) {
        onAdd(query ?? "");
        close();
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        role="combobox"
        aria-label="Customer"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        placeholder="Search customer — name, phone, GSTIN (F2)"
        value={query ?? selectedLabel}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onClick={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-[320px] overflow-hidden rounded-md border border-border bg-surface shadow-lg" onMouseDown={(e) => e.preventDefault()}>
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {!loading && hits.length === 0 && <li className="px-3 py-2 text-sm text-muted">No customers found</li>}
            {hits.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
                className={cn("flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm", i === active && "bg-primary-soft")}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-muted">{[c.phone, c.gstin].filter(Boolean).join(" · ")}</span>
                </span>
                <BalanceText paise={c.balancePaise} short className="shrink-0 text-xs" />
              </li>
            ))}
          </ul>
          {onAdd && (
            <button
              type="button"
              onMouseEnter={() => setActive(hits.length)}
              onClick={() => {
                onAdd(query ?? "");
                close();
              }}
              className={cn("flex w-full items-center gap-2 border-t border-border px-3 py-2 text-sm font-medium text-primary", active === hits.length && "bg-primary-soft")}
            >
              <Plus className="size-4" /> Add Customer{query ? ` “${query}”` : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
