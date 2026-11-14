import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print-toolbar";
import { db, schema } from "@/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { modeLabel } from "@/lib/sales/posting";
import { requirePermission } from "@/lib/session";
import { uploadUrl } from "@/lib/uploads";
import { rupeesInWords } from "@/lib/words";

export const metadata: Metadata = { title: "Receipt" };

/** Receipt voucher (A5-sized block on A4) — for standalone receipts and receipts taken with a bill. */
export default async function ReceiptPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const user = await requirePermission("sales.view");
  const id = Number((await params).id);
  const { auto } = await searchParams;
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [r] = await db.select().from(schema.receipts).where(eq(schema.receipts.id, id));
  if (!r || !user.locations.some((l) => l.id === r.locationId)) notFound();

  const [[customer], [company], [settings], modes, allocs, [createdBy], [bill]] = await Promise.all([
    db.select().from(schema.customers).where(eq(schema.customers.id, r.customerId)),
    db.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)),
    db.select().from(schema.salesSettings).where(eq(schema.salesSettings.id, 1)),
    db.select().from(schema.receiptModes).where(eq(schema.receiptModes.receiptId, id)),
    db
      .select({ a: schema.receiptAllocations, billNo: schema.salesHeader.billNo, billDate: schema.salesHeader.billDate })
      .from(schema.receiptAllocations)
      .leftJoin(schema.salesHeader, eq(schema.salesHeader.id, schema.receiptAllocations.salesId))
      .where(eq(schema.receiptAllocations.receiptId, id))
      .orderBy(asc(schema.receiptAllocations.id)),
    db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, r.createdBy)),
    r.salesId ? db.select({ billNo: schema.salesHeader.billNo }).from(schema.salesHeader).where(eq(schema.salesHeader.id, r.salesId)) : Promise.resolve([]),
  ]);
  const names = { bank1Name: settings?.bank1Name ?? "Bank 1", bank2Name: settings?.bank2Name ?? "Bank 2" };
  const order = ["CASH", "BANK1", "BANK2"];
  const cancelled = r.status === "CANCELLED";
  const td = "border border-black/40 px-1.5 py-1";
  const num = `${td} text-right tabular-nums`;

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        @media print { .no-print { display: none !important; } .page { box-shadow: none !important; margin: 0 !important; width: auto !important; } }
        .page { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #000; }
      `}</style>
      <PrintToolbar title={`${r.receiptNo} · Fatura Desk`} label={r.receiptNo} subtitle="Receipt" autoPrint={auto === "1"} />
      <div className="page relative mx-auto my-4 w-[190mm] bg-white p-[8mm] shadow-lg">
        {cancelled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 text-[60pt] font-bold tracking-widest text-black/[0.08]">CANCELLED</span>
          </div>
        )}
        <div className="flex items-start gap-4 border-b-2 border-black pb-2">
          {company?.logoPath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uploadUrl(company.logoPath)!} alt="" className="max-h-[15mm] max-w-[30mm] object-contain" />
          )}
          <div className="flex-1">
            <p className="text-[13pt] font-bold uppercase">{company?.name}</p>
            {company?.address && <p className="whitespace-pre-line text-[8.5pt]">{company.address}</p>}
            {company?.gstin && <p className="text-[8.5pt]">GSTIN: {company.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-[12pt] font-bold">RECEIPT</p>
            <p className="font-mono font-semibold">{r.receiptNo}</p>
            <p>Date: {formatDate(r.receiptDate)}</p>
          </div>
        </div>

        <p className="mt-3">
          Received with thanks from <strong>{customer?.name}</strong>
          {customer?.phone && !customer.isWalkin && ` (${customer.phone})`} the sum of <strong>₹{formatAmount(r.totalAmount)}</strong>
        </p>
        <p className="mt-1 italic">{rupeesInWords(r.totalAmount)}</p>
        {bill && <p className="mt-1">Received with bill {bill.billNo}.</p>}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <table className="w-full self-start border-collapse text-[8.5pt]">
            <tbody>
              <tr className="bg-black/5">
                <td className={`${td} font-semibold`} colSpan={2}>
                  Mode
                </td>
              </tr>
              {[...modes]
                .sort((a, b) => order.indexOf(a.mode) - order.indexOf(b.mode))
                .map((m) => (
                  <tr key={m.id}>
                    <td className={td}>{modeLabel(m.mode, names)}</td>
                    <td className={num}>{formatAmount(m.amount)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <table className="w-full self-start border-collapse text-[8.5pt]">
            <tbody>
              <tr className="bg-black/5">
                <td className={`${td} font-semibold`} colSpan={2}>
                  Adjusted against
                </td>
              </tr>
              {allocs.map(({ a, billNo, billDate }) => (
                <tr key={a.id} className={a.reversedAt ? "line-through" : undefined}>
                  <td className={td}>
                    {a.targetType === "OPENING" ? "Opening balance" : a.targetType === "ADVANCE" ? "Advance" : `${billNo} (${formatDate(billDate)})`}
                  </td>
                  <td className={num}>{formatAmount(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.remarks && <p className="mt-2">Remarks: {r.remarks}</p>}
        {cancelled && (
          <p className="mt-2 border border-black p-1.5 font-semibold">
            CANCELLED {r.cancelledAt && `on ${formatDateTime(r.cancelledAt)}`} — {r.cancelReason}
          </p>
        )}

        <div className="mt-12 flex justify-between text-[8pt]">
          <span>Received by {createdBy?.name ?? "—"}</span>
          <span className="border-t border-black px-6 pt-1">Authorised signatory</span>
        </div>
        <p className="mt-4 border-t border-black/30 pt-1 text-right text-[7pt] text-black/60">Generated by Fatura Desk</p>
      </div>
    </>
  );
}
