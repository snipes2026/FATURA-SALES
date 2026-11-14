import Link from "next/link";
import { formatDate } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { fromPaise } from "@/lib/money";
import { VOUCHER_LABEL, voucherHref, type CustomerLedger } from "@/lib/sales/ledger";
import { cn } from "@/lib/utils";

const amt = (p: number) => (p ? formatAmount(fromPaise(p)) : "");
/** "20,000.00 Dr" / "5,000.00 Cr" / "Nil" */
export function drCr(p: number) {
  if (p === 0) return "Nil";
  return `${formatAmount(fromPaise(Math.abs(p)))} ${p > 0 ? "Dr" : "Cr"}`;
}

/** Ledger table — used on screen (with links, colours) and in the print/PDF view (plain). */
export function LedgerTable({ ledger, from, to, print }: { ledger: CustomerLedger; from: string; to: string; print?: boolean }) {
  const th = print ? "border border-black/60 px-1.5 py-1 font-semibold" : "border-b border-border px-3 py-2 font-medium";
  const td = print ? "border border-black/40 px-1.5 py-1 align-top" : "border-b border-border px-3 py-1.5 align-top";
  const num = `${td} text-right tabular-nums`;
  const tone = (p: number) => (print ? "" : p > 0 ? "text-danger" : p < 0 ? "text-success" : "text-muted");

  return (
    <table className={cn("w-full border-collapse", print ? "text-[8pt]" : "text-sm")}>
      <thead className={print ? "bg-black/5" : "bg-slate-50 text-xs uppercase tracking-wide text-muted"}>
        <tr>
          <th className={`${th} text-left`}>Date</th>
          <th className={`${th} text-left`}>Voucher Type</th>
          <th className={`${th} text-left`}>Voucher No.</th>
          <th className={`${th} text-left`}>Particulars</th>
          <th className={`${th} text-right`}>Debit</th>
          <th className={`${th} text-right`}>Credit</th>
          <th className={`${th} text-right`}>Balance</th>
        </tr>
      </thead>
      <tbody>
        <tr className={print ? "font-semibold" : "bg-slate-50/60 font-medium"}>
          <td className={td}>{formatDate(from)}</td>
          <td className={td} colSpan={3}>
            Opening balance as of {formatDate(from)}
          </td>
          <td className={num}>{ledger.opening > 0 ? amt(ledger.opening) : ""}</td>
          <td className={num}>{ledger.opening < 0 ? amt(-ledger.opening) : ""}</td>
          <td className={cn(num, tone(ledger.opening))}>{drCr(ledger.opening)}</td>
        </tr>
        {ledger.entries.map((e) => {
          const href = voucherHref(e.type, e.voucherId);
          return (
            <tr key={e.id} className={print ? undefined : "hover:bg-slate-50"}>
              <td className={`${td} whitespace-nowrap`}>{formatDate(e.date)}</td>
              <td className={td}>{VOUCHER_LABEL[e.type] ?? e.type}</td>
              <td className={`${td} whitespace-nowrap font-mono text-xs`}>
                {href && !print && e.voucherNo ? (
                  <Link href={href} target="_blank" className="text-primary hover:underline">
                    {e.voucherNo}
                  </Link>
                ) : (
                  (e.voucherNo ?? "")
                )}
              </td>
              <td className={td}>{e.particulars}</td>
              <td className={num}>{amt(e.debit)}</td>
              <td className={num}>{amt(e.credit)}</td>
              <td className={cn(num, tone(e.balance))}>{drCr(e.balance)}</td>
            </tr>
          );
        })}
        {ledger.entries.length === 0 && (
          <tr>
            <td className={`${td} text-center ${print ? "" : "text-muted"}`} colSpan={7}>
              No transactions between {formatDate(from)} and {formatDate(to)}
            </td>
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <td className={td} colSpan={4}>
            Total for the period
          </td>
          <td className={num}>{amt(ledger.totalDebit) || "0.00"}</td>
          <td className={num}>{amt(ledger.totalCredit) || "0.00"}</td>
          <td className={td} />
        </tr>
        <tr className={print ? "bg-black/5 font-bold" : "bg-slate-50 font-semibold"}>
          <td className={td} colSpan={6}>
            Closing balance as of {formatDate(to)}
            {ledger.closing !== 0 && ` — ${ledger.closing > 0 ? "To Receive" : "Advance"}`}
          </td>
          <td className={cn(num, tone(ledger.closing))}>{drCr(ledger.closing)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
