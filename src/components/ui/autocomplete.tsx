"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Free-text input with suggestions (e.g. past item names). ↑/↓ moves through
 * suggestions; Enter takes the highlighted one. With nothing highlighted Enter
 * is left to the form (moves to the next field).
 */
export function Autocomplete({
  id,
  value,
  onChange,
  fetchSuggestions,
  invalid,
  disabled,
  placeholder,
  maxLength,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  fetchSuggestions: (q: string) => Promise<string[]>;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const focused = useRef(false);
  const seq = useRef(0);
  const [tick, setTick] = useState(0);

  const skipNext = useRef(false);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    if (!focused.current || disabled) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const list = await fetchSuggestions(value);
        if (mine !== seq.current) return;
        const filtered = list.filter((s) => s.toLowerCase() !== value.trim().toLowerCase());
        setItems(filtered);
        setActive(-1);
        setOpen(filtered.length > 0 && focused.current);
      } catch {
        /* suggestions are optional */
      }
    }, 200);
    return () => clearTimeout(t);
  }, [value, fetchSuggestions, disabled, tick]);

  const pick = (s: string) => {
    skipNext.current = true;
    onChange(s);
    setOpen(false);
    setItems([]);
  };

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          focused.current = true;
          setTick((t) => t + 1); // fetch suggestions for the current text
        }}
        onBlur={() => {
          focused.current = false;
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, -1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "Enter") setOpen(false);
        }}
        className={cn(
          "h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink placeholder:text-slate-400",
          "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-muted",
          invalid && "border-danger focus:border-danger focus:ring-danger/20",
        )}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg">
          <li className="px-3 py-1 text-[11px] uppercase tracking-wide text-muted">Previously used</li>
          {items.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer truncate px-3 py-1.5 text-sm", i === active && "bg-primary-soft")}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
