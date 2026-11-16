import type { Metadata } from "next";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/db";
import { formatDate } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { fromPaise } from "@/lib/money";
import { can } from "@/lib/permissions";
import { outstandingBills, type OutstandingRow } from "@/lib/sales/ledger";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ReportFilters } from "../_components/report-filters";
import { readLedgerParams } from "../_lib/params";

export const metadata: Metadata = { title: "Outstanding Bills" };

const amt = (p: number) => formatAmount(fromPaise(p));
const ageTone = (d: number) => (d > 90 ? "text-danger font-medium" : d > 30 ? "text-warning" : "text-muted");

/** Bill-wise pending list — one customer, or every customer with something pending. */
export default async function OutstandingPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requireUser();
  const { customer, today } = await readLedgerParams(await searchParams);
  const rows = await outstandingBills(db, { customerId: customer?.id, asOf: today });

  const groups = new Map<number, OutstandingRow[]>();
  for (const r of rows) groups.set(r.customerId, [...(groups.get(r.customerId) ?? []), r]);
  const total = rows.reduce((a, r) => a + r.pending, 0);
  const canReceive = can(user.role, "receipt.create");

  const th = "border-b border-border px-3 py-2 font-medium";
  const td = "border-b border-border px-3 py-1.5";
  const num = `${td} text-right tabular-nums`;

  return (
    <div className="space-y-3">
      <ReportFilters basePath="/customers/outstanding" customer={customer ? { id: customer.id, label: customer.name } : null} withDates={false} allowAll />
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className={`${th} text-left`}>Bill No.</th>
              <th className={`${th} text-left`}>Date</th>
              <th className={`${th} text-right`}>Bill Amount</th>
              <th className={`${th} text-right`}>Received</th>
              <th className={`${th} text-right`} title="Advance and sales-return credit adjusted against the bill">
                Adjusted
              </th>
              <th className={`${th} text-right`}>Pending</th>
              <th className={`${th} text-right`}>Age (days)</th>
            </tr>
          </thead>
          <tbody>
            {[...groups.values()].map((g) => {
              const sub = g.reduce((a, r) => a + r.pending, 0);
              return [
                <tr key={`h-${g[0].customerId}`} className="bg-slate-50/70">
                  <td className={`${td} font-semibold`} colSpan={5}>
                    {g[0].customerName} <span className="font-normal text-muted">· {g[0].phone}</span>
                    <Link href={`/customers/ledger?customer=${g[0].customerId}`} className="ml-3 text-xs font-normal text-primary hover:underline">
                      Ledger
                    </Link>
                    {canReceive && (
                      <Link href={`/receipts/new?customer=${g[0].customerId}`} className="ml-3 text-xs font-normal text-primary hover:underline">
                        Receive payment
                      </Link>
                    )}
                  </td>
                  <td className={`${num} font-semibold text-danger`}>{amt(sub)}</td>
                  <td className={td} />
                </tr>,
                ...g.map((r) => (
                  <tr key={`${r.customerId}-${r.key}`} className="hover:bg-slate-50">
                    <td className={`${td} pl-6 font-mono text-xs`}>
                      {r.salesId ? (
                        <Link href={`/print/sales/${r.salesId}`} target="_blank" className="text-primary hover:underline">
                          {r.ref}
                        </Link>
                      ) : (
                        <span className="font-sans text-sm">{r.ref}</span>
                      )}
                    </td>
                    <td className={td}>{formatDate(r.date)}</td>
                    <td className={num}>{amt(r.amount)}</td>
                    <td className={num}>{r.received ? amt(r.received) : "—"}</td>
                    <td className={num}>{r.adjusted ? amt(r.adjusted) : "—"}</td>
                    <td className={`${num} font-medium`}>{amt(r.pending)}</td>
                    <td className={cn(num, ageTone(r.ageDays))}>{r.ageDays}</td>
                  </tr>
                )),
              ];
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted">
                  <Wallet className="mx-auto mb-2 size-8 text-slate-300" />
                  {customer ? `${customer.name} has no pending bills.` : "No pending bills."}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className={td} colSpan={5}>
                  Total pending{groups.size > 1 ? ` (${groups.size} customers)` : ""}
                </td>
                <td className={`${num} text-danger`}>{amt(total)}</td>
                <td className={td} />
              </tr>
            </tfoot>
          )}
        </table>
      </Card>
      {customer && canReceive && rows.length > 0 && (
        <Link href={`/receipts/new?customer=${customer.id}`} className={buttonVariants()}>
          <Wallet /> Receive payment from {customer.name}
        </Link>
      )}
    </div>
  );
}
