import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, gte, ilike, inArray, lte } from "drizzle-orm";
import { Eye, Plus, Printer } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { db, schema } from "@/db";
import { formatDate, todayIST } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { SalesFilters } from "./_components/sales-filters";

export const metadata: Metadata = { title: "Sales" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LIMIT = 500;
const amt = (p: number) => formatAmount(fromPaise(p));

function daysAgo(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Sales List: filter by date, customer, bill no. and status; View / Print. No edit — a bill is cancelled instead. */
export default async function SalesListPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; customer?: string; q?: string; status?: string }> }) {
  const user = await requirePermission("sales.view");
  const sp = await searchParams;
  const today = todayIST();
  const from = sp.from && ISO.test(sp.from) ? sp.from : daysAgo(today, 30);
  const to = sp.to && ISO.test(sp.to) ? sp.to : today;
  const status = sp.status === "SAVED" || sp.status === "CANCELLED" ? sp.status : "ALL";
  const customerId = Number(sp.customer) > 0 ? Number(sp.customer) : null;
  const q = (sp.q ?? "").trim().slice(0, 40);
  const locIds = user.locations.map((l) => l.id);

  const [rows, customer] = await Promise.all([
    locIds.length
      ? db
          .select({
            id: schema.salesHeader.id,
            billNo: schema.salesHeader.billNo,
            billDate: schema.salesHeader.billDate,
            customerName: schema.salesHeader.customerName,
            locationName: schema.locations.name,
            totalQty: schema.salesHeader.totalQty,
            netAmount: schema.salesHeader.netAmount,
            creditAmount: schema.salesHeader.creditAmount,
            advanceUsed: schema.salesHeader.advanceUsed,
            status: schema.salesHeader.status,
          })
          .from(schema.salesHeader)
          .innerJoin(schema.locations, eq(schema.locations.id, schema.salesHeader.locationId))
          .where(
            and(
              inArray(schema.salesHeader.locationId, locIds),
              gte(schema.salesHeader.billDate, from),
              lte(schema.salesHeader.billDate, to),
              customerId ? eq(schema.salesHeader.customerId, customerId) : undefined,
              q ? ilike(schema.salesHeader.billNo, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`) : undefined,
              status !== "ALL" ? eq(schema.salesHeader.status, status) : undefined,
            ),
          )
          .orderBy(desc(schema.salesHeader.billDate), desc(schema.salesHeader.id))
          .limit(LIMIT + 1)
      : Promise.resolve([]),
    customerId ? db.select({ id: schema.customers.id, name: schema.customers.name }).from(schema.customers).where(eq(schema.customers.id, customerId)) : Promise.resolve([]),
  ]);
  const shown = rows.slice(0, LIMIT);
  const saved = shown.filter((r) => r.status === "SAVED");
  const totalNet = saved.reduce((a, r) => a + toPaise(r.netAmount), 0);
  const totalCredit = saved.reduce((a, r) => a + toPaise(r.creditAmount), 0);

  const th = "border-b border-border px-3 py-2 font-medium";
  const td = "border-b border-border px-3 py-1.5";
  const num = `${td} text-right tabular-nums`;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <SalesFilters initial={{ from, to, customer: customer[0] ? { id: customer[0].id, label: customer[0].name } : null, q, status }} />
        </div>
        {can(user.role, "sales.create") && (
          <Link href="/sales/new" className={buttonVariants({ size: "lg" })}>
            <Plus /> New Sale
          </Link>
        )}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className={`${th} text-left`}>Bill No.</th>
              <th className={`${th} text-left`}>Date</th>
              <th className={`${th} text-left`}>Customer</th>
              <th className={`${th} text-left`}>Location</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} text-right`}>Net Amount</th>
              <th className={`${th} text-right`}>Paid</th>
              <th className={`${th} text-right`}>Credit</th>
              <th className={`${th} text-left`}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const cancelled = r.status === "CANCELLED";
              const net = toPaise(r.netAmount);
              const credit = toPaise(r.creditAmount);
              return (
                <tr key={r.id} className={cn("hover:bg-slate-50", cancelled && "text-muted")}>
                  <td className={`${td} font-mono text-xs`}>
                    <Link href={`/sales/${r.id}`} className={cn("text-primary hover:underline", cancelled && "line-through")}>
                      {r.billNo}
                    </Link>
                  </td>
                  <td className={td}>{formatDate(r.billDate)}</td>
                  <td className={td}>{r.customerName}</td>
                  <td className={td}>{r.locationName}</td>
                  <td className={num}>{r.totalQty}</td>
                  <td className={`${num} font-medium`}>{amt(net)}</td>
                  <td className={num}>{amt(net - credit)}</td>
                  <td className={cn(num, credit > 0 && !cancelled && "text-danger")}>{credit ? amt(credit) : "—"}</td>
                  <td className={td}>{cancelled ? <Chip tone="danger">Cancelled</Chip> : <Chip tone="success">Saved</Chip>}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <Link href={`/sales/${r.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`View ${r.billNo}`}>
                      <Eye />
                    </Link>
                    <Link href={`/print/sales/${r.id}`} target="_blank" className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Print ${r.billNo}`}>
                      <Printer />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-muted">
                  No bills between {formatDate(from)} and {formatDate(to)}
                  {customer[0] ? ` for ${customer[0].name}` : ""}.
                </td>
              </tr>
            )}
          </tbody>
          {saved.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className={td} colSpan={5}>
                  {saved.length} saved {saved.length === 1 ? "bill" : "bills"}
                  {shown.length > saved.length && <span className="font-normal text-muted"> · {shown.length - saved.length} cancelled (not in totals)</span>}
                </td>
                <td className={num}>{amt(totalNet)}</td>
                <td className={num}>{amt(totalNet - totalCredit)}</td>
                <td className={`${num} text-danger`}>{totalCredit ? amt(totalCredit) : "—"}</td>
                <td className={td} colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length > LIMIT && <p className="border-t border-border px-3 py-2 text-xs text-warning">Showing the latest {LIMIT} bills — narrow the dates to see the rest.</p>}
      </Card>
    </div>
  );
}
