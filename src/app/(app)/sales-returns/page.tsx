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
import { SalesFilters } from "../sales/_components/sales-filters";

export const metadata: Metadata = { title: "Sales Returns" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LIMIT = 500;
const amt = (p: number) => formatAmount(fromPaise(p));

function daysAgo(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Sales Return List: filter by date, customer, return no. and status; View / Print. No edit — a credit note is cancelled instead. */
export default async function SalesReturnListPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; customer?: string; q?: string; status?: string }> }) {
  const user = await requirePermission("salesReturn.view");
  const sp = await searchParams;
  const today = todayIST();
  const from = sp.from && ISO.test(sp.from) ? sp.from : daysAgo(today, 30);
  const to = sp.to && ISO.test(sp.to) ? sp.to : today;
  const status = sp.status === "SAVED" || sp.status === "CANCELLED" ? sp.status : "ALL";
  const customerId = Number(sp.customer) > 0 ? Number(sp.customer) : null;
  const q = (sp.q ?? "").trim().slice(0, 40);
  const locIds = user.locations.map((l) => l.id);
  const H = schema.salesReturnHeader;

  const [rows, customer] = await Promise.all([
    locIds.length
      ? db
          .select({
            id: H.id,
            returnNo: H.returnNo,
            returnDate: H.returnDate,
            customerName: H.customerName,
            againstBillNo: schema.salesHeader.billNo,
            locationName: schema.locations.name,
            totalQty: H.totalQty,
            netAmount: H.netAmount,
            appliedToDues: H.appliedToDues,
            advanceCreated: H.advanceCreated,
            refundAmount: H.refundAmount,
            status: H.status,
          })
          .from(H)
          .innerJoin(schema.locations, eq(schema.locations.id, H.locationId))
          .leftJoin(schema.salesHeader, eq(schema.salesHeader.id, H.againstSalesId))
          .where(
            and(
              inArray(H.locationId, locIds),
              gte(H.returnDate, from),
              lte(H.returnDate, to),
              customerId ? eq(H.customerId, customerId) : undefined,
              q ? ilike(H.returnNo, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`) : undefined,
              status !== "ALL" ? eq(H.status, status) : undefined,
            ),
          )
          .orderBy(desc(H.returnDate), desc(H.id))
          .limit(LIMIT + 1)
      : Promise.resolve([]),
    customerId ? db.select({ id: schema.customers.id, name: schema.customers.name }).from(schema.customers).where(eq(schema.customers.id, customerId)) : Promise.resolve([]),
  ]);
  const shown = rows.slice(0, LIMIT);
  const saved = shown.filter((r) => r.status === "SAVED");
  const sum = (k: "netAmount" | "appliedToDues" | "advanceCreated" | "refundAmount") => saved.reduce((a, r) => a + toPaise(r[k]), 0);

  const th = "border-b border-border px-3 py-2 font-medium";
  const td = "border-b border-border px-3 py-1.5";
  const num = `${td} text-right tabular-nums`;
  const dash = (v: string) => (toPaise(v) ? amt(toPaise(v)) : "—");

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <SalesFilters
            basePath="/sales-returns"
            numberLabel="Return no."
            initial={{ from, to, customer: customer[0] ? { id: customer[0].id, label: customer[0].name } : null, q, status }}
          />
        </div>
        {can(user.role, "salesReturn.create") && (
          <Link href="/sales-returns/new" className={buttonVariants({ size: "lg" })}>
            <Plus /> New Return
          </Link>
        )}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className={`${th} text-left`}>Return No.</th>
              <th className={`${th} text-left`}>Date</th>
              <th className={`${th} text-left`}>Customer</th>
              <th className={`${th} text-left`}>Against Bill</th>
              <th className={`${th} text-left`}>Location</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} text-right`}>Return Value</th>
              <th className={`${th} text-right`}>To Bills</th>
              <th className={`${th} text-right`}>Advance</th>
              <th className={`${th} text-right`}>Refund</th>
              <th className={`${th} text-left`}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const cancelled = r.status === "CANCELLED";
              return (
                <tr key={r.id} className={cn("hover:bg-slate-50", cancelled && "text-muted")}>
                  <td className={`${td} font-mono text-xs`}>
                    <Link href={`/sales-returns/${r.id}`} className={cn("text-primary hover:underline", cancelled && "line-through")}>
                      {r.returnNo}
                    </Link>
                  </td>
                  <td className={td}>{formatDate(r.returnDate)}</td>
                  <td className={td}>{r.customerName}</td>
                  <td className={`${td} font-mono text-xs`}>{r.againstBillNo ?? "—"}</td>
                  <td className={td}>{r.locationName}</td>
                  <td className={num}>{r.totalQty}</td>
                  <td className={`${num} font-medium`}>{amt(toPaise(r.netAmount))}</td>
                  <td className={num}>{dash(r.appliedToDues)}</td>
                  <td className={cn(num, !cancelled && toPaise(r.advanceCreated) > 0 && "text-success")}>{dash(r.advanceCreated)}</td>
                  <td className={cn(num, !cancelled && toPaise(r.refundAmount) > 0 && "text-warning")}>{dash(r.refundAmount)}</td>
                  <td className={td}>{cancelled ? <Chip tone="danger">Cancelled</Chip> : <Chip tone="success">Saved</Chip>}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <Link href={`/sales-returns/${r.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`View ${r.returnNo}`}>
                      <Eye />
                    </Link>
                    <Link href={`/print/sales-returns/${r.id}`} target="_blank" className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Print ${r.returnNo}`}>
                      <Printer />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-10 text-center text-muted">
                  No sales returns between {formatDate(from)} and {formatDate(to)}
                  {customer[0] ? ` for ${customer[0].name}` : ""}.
                </td>
              </tr>
            )}
          </tbody>
          {saved.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className={td} colSpan={6}>
                  {saved.length} saved {saved.length === 1 ? "return" : "returns"}
                  {shown.length > saved.length && <span className="font-normal text-muted"> · {shown.length - saved.length} cancelled (not in totals)</span>}
                </td>
                <td className={num}>{amt(sum("netAmount"))}</td>
                <td className={num}>{amt(sum("appliedToDues"))}</td>
                <td className={num}>{amt(sum("advanceCreated"))}</td>
                <td className={num}>{amt(sum("refundAmount"))}</td>
                <td className={td} colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length > LIMIT && <p className="border-t border-border px-3 py-2 text-xs text-warning">Showing the latest {LIMIT} returns — narrow the dates to see the rest.</p>}
      </Card>
    </div>
  );
}
