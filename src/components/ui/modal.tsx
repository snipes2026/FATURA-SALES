"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Centered dialog rendered into <body>. Esc closes; first field gets focus. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      ref.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select, textarea, [data-autofocus]")?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto p-4 pt-[10vh]" role="dialog" aria-modal aria-label={title}>
      <div className="fixed inset-0 bg-slate-900/40" onClick={onClose} />
      <div ref={ref} className="relative w-full rounded-[var(--radius-card)] bg-surface shadow-2xl" style={{ maxWidth: width }}>
        <div className="flex h-12 items-center justify-between border-b border-border px-5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-slate-100">
            <X className="size-5 text-muted" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger" | "warning";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width={440}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={pending} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3 text-sm">
        {tone !== "primary" && <AlertTriangle className={cn("mt-0.5 size-5 shrink-0", tone === "danger" ? "text-danger" : "text-warning")} />}
        <div>{message}</div>
      </div>
    </Modal>
  );
}
