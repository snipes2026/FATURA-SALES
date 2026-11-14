import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { db, schema } from "@/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatAmount, stateName } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CancelReceiptButton, CancelSaleButton } from "../_components/cancel-dialogs";
import { loadBill } from "../_lib/load-bill";

export const metadata: Metadata = { title: "Sales Bill" };

const amt = (v: string | number) => formatAmount(v);
const bal = (v: string) => {
  const p = toPaise(v);
  return p === 0 ? "Nil" : `₹${formatAmount(fromPaise(Math.abs(p)))} ${p > 0 ? "Dr" : "Cr"}`;
};

/** Read-only bill view (no edit). Admin can cancel; receipts allocated to the bill are listed with their own cancel. */
export default async function SalesBillPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const bill = await loadBill(id);
  if (!bill || !user.locations.some((l) => l.id === bill.h.locationId)) notFound();
  const { h, lines, payments, location } = bill;

  const allocs = await db
    .select({
      allocId: schema.receiptAllocations.id,
      amount: schema.receiptAllocations.amount,
      reversedAt: schema.receiptAllocations.reversedAt,
      receiptId: schema.receipts.id,
      receiptNo: schema.receipts.receiptNo,
      receiptDate: schema.receipts.receiptDate,
      source: schema.receipts.source,
      status: schema.receipts.status,
      total: schema.receipts.totalAmount,
    })
    .from(schema.receiptAllocations)
    .innerJoin(schema.receipts, eq(schema.receipts.id, schema.receiptAllocations.receiptId))
    .where(eq(schema.receiptAllocations.salesId, id))
    .orderBy(asc(schema.receiptAllocations.id));
  const [cancelledBy] = h.cancelledBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, h.cancelledBy)) : [];

  const saved = h.status === "SAVED";
  const canCancel = saved && can(user.role, "sales.cancel");
  const [cust] = await db.select({ isWalkin: schema.customers.isWalkin }).from(schema.customers).where(eq(schema.customers.id, h.customerId));
  const isWalkin = !!cust?.isWalkin;
  const paidWithBill = allocs.filter((a) => a.source === "SALE" && !a.reversedAt).reduce((s, a) => s + toPaise(a.amount), 0);
  const laterOpen = allocs.filter((a) => a.source !== "SALE" && !a.reversedAt);

  const consequences = [
    `${h.totalQty} pcs go back into stock at ${location?.name}.`,
    `${h.customerName}'s balance goes down by ₹${amt(h.netAmount)}.`,
    ...(toPaise(h.advanceUsed) > 0 ? [`₹${amt(h.advanceUsed)} of advance used on this bill goes back to the customer.`] : []),
    ...(paidWithBill > 0
      ? [isWalkin ? `₹${formatAmount(fromPaise(paidWithBill))} paid for this bill is refunded.` : `₹${formatAmount(fromPaise(paidWithBill))} paid for this bill is kept as the customer's advance.`]
      : []),
  ];

  const td = "border-b border-border px-3 py-1.5";
  const num = `${td} text-right tabular-nums`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/sales" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft /> Sales
        </Link>
        <h2 className="font-mono text-lg font-semibold">{h.billNo}</h2>
        {saved ? <Chip tone="success">Saved</Chip> : <Chip tone="danger">Cancelled</Chip>}
        <span className="ml-auto flex gap-2">
          <Link href={`/print/sales/${id}`} target="_blank" className={buttonVariants({ variant: "secondary" })}>
            <Printer /> Print
          </Link>
          {canCancel && laterOpen.length === 0 && <CancelSaleButton id={id} version={h.version} billNo={h.billNo} consequences={consequences} />}
        </span>
      </div>

      {!saved && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Cancelled {h.cancelledAt && `on ${formatDateTime(h.cancelledAt)}`} {cancelledBy && `by ${cancelledBy.name}`} — {h.cancelReason}
        </div>
      )}
      {canCancel && laterOpen.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          This bill can&apos;t be cancelled while later receipts are allocated to it ({[...new Set(laterOpen.map((a) => a.receiptNo))].join(", ")}). Cancel those receipts below first.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Items" />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className={`${td} text-left font-medium`}>#</th>
                  <th className={`${td} text-left font-medium`}>Barcode</th>
                  <th className={`${td} text-left font-medium`}>Item</th>
                  <th className={`${td} text-left font-medium`}>HSN</th>
                  <th className={`${td} text-right font-medium`}>GST %</th>
                  <th className={`${td} text-right font-medium`}>Qty</th>
                  <th className={`${td} text-right font-medium`}>Rate</th>
                  <th className={`${td} text-right font-medium`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className={td}>{l.lineNo}</td>
                    <td className={`${td} font-mono text-xs`}>{l.barcode}</td>
                    <td className={td}>
                      {l.itemName}
                      {l.priceEdited && <span className="ml-2 text-xs text-warning">price edited</span>}
                    </td>
                    <td className={td}>{l.hsnCode}</td>
                    <td className={num}>{h.gstOverridden ? "—" : `${Number(l.gstRate)}%`}</td>
                    <td className={num}>{l.qty}</td>
                    <td className={num}>{amt(l.rate)}</td>
                    <td className={num}>{amt(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Bill" />
            <CardBody className="space-y-1 text-sm">
              <Row k="Date" v={formatDate(h.billDate)} />
              <Row k="Customer" v={h.customerName} />
              {h.customerGstin && <Row k="GSTIN" v={h.customerGstin} />}
              <Row k="State" v={`${stateName(h.customerStateCode)} · ${h.taxType === "INTRA" ? "CGST + SGST" : "IGST"}`} />
              <Row k="Location" v={location?.name ?? ""} />
              <Row k="GST mode" v={h.gstMode === "INCLUDES" ? "Includes GST" : "Add GST"} />
              <hr className="my-2 border-border" />
              <Row k="Gross" v={amt(h.gross)} />
              <Row k="Taxable" v={amt(h.taxable)} />
              <Row k={`GST${h.gstOverridden ? " (entered)" : ""}`} v={amt(h.gstAmount)} />
              {toPaise(h.roundOff) !== 0 && <Row k="Round off" v={amt(h.roundOff)} />}
              <Row k="Net Amount" v={`₹${amt(h.netAmount)}`} strong />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Payment" />
            <CardBody className="space-y-1 text-sm">
              {toPaise(h.cashTendered) > 0 && <Row k={toPaise(h.changeReturned) > 0 ? "Cash tendered" : "Cash"} v={amt(h.cashTendered)} />}
              {toPaise(h.changeReturned) > 0 && <Row k="Change returned" v={amt(h.changeReturned)} />}
              {payments
                .filter((p) => p.mode !== "CASH")
                .map((p) => (
                  <Row key={p.mode} k={p.label} v={formatAmount(fromPaise(p.amount))} />
                ))}
              {toPaise(h.advanceUsed) > 0 && <Row k="Advance adjusted" v={amt(h.advanceUsed)} />}
              <Row k="Credit" v={toPaise(h.creditAmount) ? amt(h.creditAmount) : "—"} />
              <hr className="my-2 border-border" />
              <Row k="Previous balance" v={bal(h.prevBalance)} />
              <Row k="Balance after bill" v={bal(h.balanceAfter)} strong />
              <p className="pt-1 text-xs text-muted">
                Billed by {bill.createdBy} · {formatDateTime(h.createdAt)}
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Receipts allocated to this bill" />
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className={`${td} text-left font-medium`}>Receipt</th>
              <th className={`${td} text-left font-medium`}>Date</th>
              <th className={`${td} text-left font-medium`}>Taken</th>
              <th className={`${td} text-right font-medium`}>For this bill</th>
              <th className={`${td} text-left font-medium`}>Status</th>
              <th className={td} />
            </tr>
          </thead>
          <tbody>
            {allocs.map((a) => (
              <tr key={a.allocId} className={cn(a.reversedAt && "text-muted")}>
                <td className={`${td} font-mono text-xs`}>
                  <Link href={`/print/receipts/${a.receiptId}`} target="_blank" className="text-primary hover:underline">
                    {a.receiptNo}
                  </Link>
                </td>
                <td className={td}>{formatDate(a.receiptDate)}</td>
                <td className={td}>{a.source === "SALE" ? "With the bill" : "Later receipt"}</td>
                <td className={cn(num, a.reversedAt && "line-through")}>{amt(a.amount)}</td>
                <td className={td}>{a.status === "CANCELLED" ? <Chip tone="danger">Receipt cancelled</Chip> : a.reversedAt ? <Chip>Reversed</Chip> : <Chip tone="success">Active</Chip>}</td>
                <td className={`${td} text-right`}>
                  {a.status === "SAVED" && !a.reversedAt && a.source !== "SALE" && can(user.role, "sales.cancel") && (
                    <CancelReceiptButton id={a.receiptId} receiptNo={a.receiptNo} amount={formatAmount(a.total)} />
                  )}
                </td>
              </tr>
            ))}
            {allocs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                  Nothing received against this bill yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "font-semibold")}>
      <span className="text-muted">{k}</span>
      <span className="text-right tabular-nums">{v}</span>
    </div>
  );
}
