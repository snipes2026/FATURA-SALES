import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
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
import { balanceLabel } from "@/lib/validation/sales";
import { CancelReturnButton } from "../_components/cancel-return";
import { loadReturn } from "../_lib/load-return";

export const metadata: Metadata = { title: "Credit Note" };

const amt = (v: string | number) => formatAmount(v);
const p2 = (p: number) => formatAmount(fromPaise(p));
function bal(v: string) {
  const p = toPaise(v);
  const b = balanceLabel(p);
  return b.side === "NIL" ? "Nil" : `₹${p2(Math.abs(p))} ${b.side === "DR" ? "Dr" : "Cr"}`;
}

/** Credit note view (no edit): items, GST, how it was settled; Print and Cancel. */
export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("salesReturn.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const r = await loadReturn(id);
  if (!r || !user.locations.some((l) => l.id === r.h.locationId)) notFound();
  const { h, lines, location, against, applied } = r;
  const [cancelledBy] = h.cancelledBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, h.cancelledBy)) : [];

  const saved = h.status === "SAVED";
  const canCancel = saved && can(user.role, "salesReturn.cancel");
  const refund = toPaise(h.refundAmount);
  const consequences = [
    `${h.totalQty} pcs go back out of stock at ${location?.name} (refused if they have already been sold).`,
    `${h.customerName}'s balance goes up by ₹${p2(toPaise(h.netAmount) - refund)}.`,
    ...(applied.length ? [`${applied.map((a) => `${a.ref} ₹${p2(a.amount)}`).join(", ")} ${applied.length === 1 ? "becomes" : "become"} pending again.`] : []),
    ...(toPaise(h.advanceCreated) > 0 ? [`The ₹${amt(h.advanceCreated)} advance it left is withdrawn (refused if it has already been used on a later bill).`] : []),
    ...(refund > 0 ? [`The ₹${p2(refund)} refund is reversed — the money comes back into ${r.refundLabel}.`] : []),
  ];

  const td = "border-b border-border px-3 py-1.5";
  const num = `${td} text-right tabular-nums`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/sales-returns" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeft /> Sales Returns
        </Link>
        <h2 className="font-mono text-lg font-semibold">{h.returnNo}</h2>
        {saved ? <Chip tone="success">Saved</Chip> : <Chip tone="danger">Cancelled</Chip>}
        <span className="ml-auto flex gap-2">
          <Link href={`/print/sales-returns/${id}`} target="_blank" className={buttonVariants({ variant: "secondary" })}>
            <Printer /> Print
          </Link>
          {canCancel && <CancelReturnButton id={id} version={h.version} returnNo={h.returnNo} consequences={consequences} />}
        </span>
      </div>

      {!saved && (
        <div className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Cancelled {h.cancelledAt && `on ${formatDateTime(h.cancelledAt)}`} {cancelledBy && `by ${cancelledBy.name}`} — {h.cancelReason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Items returned" />
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
                    <td className={td}>{l.itemName}</td>
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
            <CardHeader title="Credit note" />
            <CardBody className="space-y-1 text-sm">
              <Row k="Date" v={formatDate(h.returnDate)} />
              <Row k="Customer" v={h.customerName} />
              {h.customerGstin && <Row k="GSTIN" v={h.customerGstin} />}
              <Row k="State" v={`${stateName(h.customerStateCode)} · ${h.taxType === "INTRA" ? "CGST + SGST" : "IGST"}`} />
              {against ? (
                <div className="flex justify-between gap-3">
                  <span className="text-muted">Against bill</span>
                  <Link href={`/sales/${against.id}`} className="font-mono text-primary hover:underline">
                    {against.billNo} · {formatDate(against.billDate)}
                  </Link>
                </div>
              ) : (
                <Row k="Against bill" v="— (free-form)" />
              )}
              <Row k="Stock back to" v={location?.name ?? ""} />
              <Row k="GST mode" v={h.gstMode === "INCLUDES" ? "Includes GST" : "Add GST"} />
              <hr className="my-2 border-border" />
              <Row k="Gross" v={amt(h.gross)} />
              <Row k="Taxable" v={amt(h.taxable)} />
              <Row k={`GST${h.gstOverridden ? " (entered)" : ""}`} v={amt(h.gstAmount)} />
              {toPaise(h.roundOff) !== 0 && <Row k="Round off" v={amt(h.roundOff)} />}
              <Row k="Net Return Value" v={`₹${amt(h.netAmount)}`} strong />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Settled as" />
            <CardBody className="space-y-1 text-sm">
              {applied.map((a) => (
                <Row key={`${a.ref}-${a.salesId}`} k={`Applied to ${a.ref}`} v={p2(a.amount)} />
              ))}
              {toPaise(h.advanceCreated) > 0 && <Row k="Kept as advance" v={amt(h.advanceCreated)} />}
              {refund > 0 && <Row k={`Refund (${r.refundLabel})`} v={p2(refund)} />}
              <hr className="my-2 border-border" />
              <Row k="Balance before" v={bal(h.prevBalance)} />
              <Row k="Balance after" v={bal(h.balanceAfter)} strong />
              <p className="pt-1 text-xs text-muted">
                Entered by {r.createdBy} · {formatDateTime(h.createdAt)}
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
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
