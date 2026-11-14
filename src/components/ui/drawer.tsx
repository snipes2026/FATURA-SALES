"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "./button";

/**
 * Right-side drawer holding a form. Esc closes, Ctrl+S submits, and the first
 * field is focused on open.
 */
export function Drawer({
  open,
  title,
  onClose,
  onSubmit,
  pending,
  submitLabel = "Save",
  width = 480,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  pending?: boolean;
  submitLabel?: string;
  width?: number;
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      formRef.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select, textarea")?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) onSubmit();
        }}
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-surface shadow-2xl"
        style={{ maxWidth: width }}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-slate-100">
            <X className="size-5 text-muted" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span className="hidden text-xs text-muted sm:block">Ctrl+S to save · Esc to close</span>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
