import { cn } from "@/lib/utils";

export const APP_NAME = "Fatura Desk";
export const APP_VERSION = "0.1";

export function Monogram({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-[13px] font-bold tracking-tight text-white",
        className,
      )}
    >
      FD
    </span>
  );
}

export function Wordmark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Monogram />
      {!collapsed && <span className="text-base font-semibold tracking-tight text-ink">{APP_NAME}</span>}
    </span>
  );
}
