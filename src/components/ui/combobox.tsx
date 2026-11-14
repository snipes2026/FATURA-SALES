"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { focusNext } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

export type ComboOption = { value: string; label: string; hint?: string };

const MAX_SHOWN = 50;

/**
 * Searchable select. Type to filter, ↑/↓ to move, Enter to pick (then focus
 * moves to the next field), Esc to close. `footer` renders below the list,
 * e.g. a "+ Add supplier" button.
 */
export function Combobox({
  id,
  name,
  value,
  onChange,
  options,
  placeholder = "Search…",
  invalid,
  disabled,
  autoFocus,
  clearable = true,
  footer,
  ariaLabel,
}: {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  clearable?: boolean;
  footer?: (close: () => void) => React.ReactNode;
  ariaLabel?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null = not typing, show selected label
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    const list = q ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q)) : options;
    return list.slice(0, MAX_SHOWN);
  }, [options, query]);

  useEffect(() => setActive(0), [query]);

  const navigated = useRef(false);
  const close = () => {
    setOpen(false);
    setQuery(null);
    navigated.current = false;
  };

  const pick = (o: ComboOption, moveOn: boolean) => {
    onChange(o.value);
    close();
    if (moveOn && inputRef.current) focusNext(inputRef.current);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") navigated.current = true;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault(); // handled here, not by the entry root
      // Pick only when the user typed or moved with the arrows; otherwise Enter just moves on (skips the field).
      if (open && filtered[active] && (query || navigated.current)) pick(filtered[active], true);
      else {
        close();
        focusNext(e.currentTarget);
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      if (open && query && filtered[active]) onChange(filtered[active].value);
      close();
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          name={name}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-label={ariaLabel}
          aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          value={query ?? selected?.label ?? ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={(e) => e.currentTarget.select()}
          onClick={() => setOpen(true)}
          onBlur={close}
          onKeyDown={onKeyDown}
          className={cn(
            "h-9 w-full rounded-md border border-border bg-surface pl-3 pr-14 text-sm text-ink placeholder:text-slate-400",
            "focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-muted",
            invalid && "border-danger focus:border-danger focus:ring-danger/20",
          )}
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {clearable && value && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Clear"
              className="rounded p-1 text-slate-400 hover:text-ink"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange("");
                inputRef.current?.focus();
              }}
            >
              <X className="size-3.5" />
            </button>
          )}
          <ChevronDown className="pointer-events-none mr-1.5 size-4 text-slate-400" />
        </div>
      </div>
      {open && !disabled && (
        <div className="absolute z-40 mt-1 w-full min-w-[220px] overflow-hidden rounded-md border border-border bg-surface shadow-lg">
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches</li>}
            {filtered.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o, true);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("cursor-pointer px-3 py-1.5 text-sm", i === active && "bg-primary-soft", o.value === value && "font-medium text-primary")}
              >
                <span className="block truncate">{o.label}</span>
                {o.hint && <span className="block truncate text-xs text-muted">{o.hint}</span>}
              </li>
            ))}
          </ul>
          {footer && (
            <div className="border-t border-border p-1" onMouseDown={(e) => e.preventDefault()}>
              {footer(close)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
