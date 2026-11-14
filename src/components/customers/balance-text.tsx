import { formatAmount } from "@/lib/india";
import { fromPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { balanceLabel } from "@/lib/validation/sales";

/** "₹20,000.00 Dr (To Receive)" in red, "₹5,000.00 Cr (Advance)" in green, or "Nil". */
export function BalanceText({ paise, short, className }: { paise: number; short?: boolean; className?: string }) {
  const b = balanceLabel(paise);
  if (b.side === "NIL") return <span className={cn("text-muted", className)}>Nil</span>;
  return (
    <span className={cn("font-medium tabular-nums", b.side === "DR" ? "text-danger" : "text-success", className)}>
      ₹{formatAmount(fromPaise(Math.abs(paise)))} {short ? (b.side === "DR" ? "Dr" : "Cr") : b.text}
    </span>
  );
}
