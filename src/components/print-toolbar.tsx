"use client";

import { useEffect, useRef } from "react";
import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintToolbar({
  title,
  label,
  autoPrint,
  subtitle = "A4 · GRN",
  children,
}: {
  title: string;
  label: string;
  autoPrint: boolean;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  const done = useRef(false);
  useEffect(() => {
    document.title = title;
    if (autoPrint && !done.current) {
      done.current = true;
      const t = setTimeout(() => window.print(), 500);
      return () => clearTimeout(t);
    }
  }, [title, autoPrint]);

  return (
    <div className="no-print sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm">
      <strong>{label}</strong>
      <span className="text-slate-600">{subtitle}</span>
      <span className="ml-auto flex gap-2">
        {children}
        <Button size="sm" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
        <Button size="sm" variant="secondary" onClick={() => window.close()}>
          <X /> Close
        </Button>
      </span>
    </div>
  );
}
