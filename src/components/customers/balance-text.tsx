import { formatAmount } from "@/lib/india";
import { fromPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { balanceLabel } from "@/lib/validation/sales";

/**
 * "₹20,000.00 Dr (To Receive)" in red, "₹5,000.00 Cr (Advance)" in green, or "Nil".
 * With `returnCredit`, a Cr balance also shows "of which return credit ₹Y".
 */
export function BalanceText({ paise, short, className, returnCredit }: { paise: number; short?: boolean; className?: string; returnCredit?: number }) {
  const b = balanceLabel(paise);
  if (b.side === "NIL") return <span className={cn("text-muted", className)}>Nil</span>;
  return (
    <span className={cn("font-medium tabular-nums", b.side === "DR" ? "text-danger" : "text-success", className)}>
      ₹{formatAmount(fromPaise(Math.abs(paise)))} {short ? (b.side === "DR" ? "Dr" : "Cr") : b.text}
      {b.side === "CR" && (returnCredit ?? 0) > 0 && (
        <span className="ml-1 text-xs font-normal text-muted">(of which return credit ₹{formatAmount(fromPaise(returnCredit!))})</span>
      )}
    </span>
  );
}
