import type { Metadata } from "next";
import { asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatAmount, stateName } from "@/lib/india";
import { requirePermission } from "@/lib/session";
import { uploadUrl } from "@/lib/uploads";
import { rupeesInWords } from "@/lib/words";
import { PrintToolbar } from "@/components/print-toolbar";

export const metadata: Metadata = { title: "GRN" };

const amt = (v: string | number | null | undefined) => formatAmount(v ?? 0);
/** Signed rupees with a true minus sign: −₹1,250.00 */
const signedInr = (v: string | number) => (Number(v) < 0 ? `−₹${amt(-Number(v))}` : `₹${amt(v)}`);

/** A4 GRN printout. Company details come from Settings → Company Profile. */
export default async function GrnPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const user = await requirePermission("grn.view");
  const id = Number((await params).id);
  const { auto } = await searchParams;
  if (!Number.isInteger(id) || id <= 0) notFound();

  const [h] = await db.select().from(schema.grnHeader).where(eq(schema.grnHeader.id, id));
  if (!h || !user.locations.some((l) => l.id === h.locationId)) notFound();

  const [[company], [supplier], [location], transport, lines, charges, catConfig, [createdBy]] = await Promise.all([
    db.select().from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)),
    db.select().from(schema.suppliers).where(eq(schema.suppliers.id, h.supplierId)),
    db.select().from(schema.locations).where(eq(schema.locations.id, h.locationId)),
    h.transportId ? db.select().from(schema.transports).where(eq(schema.transports.id, h.transportId)) : Promise.resolve([]),
    db.select().from(schema.grnLines).where(eq(schema.grnLines.grnId, id)).orderBy(asc(schema.grnLines.lineNo)),
    db.select().from(schema.grnCharges).where(eq(schema.grnCharges.grnId, id)).orderBy(asc(schema.grnCharges.sortOrder), asc(schema.grnCharges.id)),
    db.select().from(schema.categoryConfig).orderBy(asc(schema.categoryConfig.slot)),
    db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, h.createdBy)),
  ]);
  const deptIds = [...new Set(lines.map((l) => l.departmentId))];
  const valueIds = [...new Set(lines.flatMap((l) => [l.cat1ValueId, l.cat2ValueId, l.cat3ValueId, l.cat4ValueId]).filter((v): v is number => v != null))];
  const [depts, values] = await Promise.all([
    deptIds.length ? db.select({ id: schema.departments.id, name: schema.departments.name }).from(schema.departments).where(inArray(schema.departments.id, deptIds)) : [],
    valueIds.length ? db.select({ id: schema.categoryValues.id, value: schema.categoryValues.value }).from(schema.categoryValues).where(inArray(schema.categoryValues.id, valueIds)) : [],
  ]);
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  const valueName = new Map(values.map((v) => [v.id, v.value]));
  const visibleSlots = catConfig.filter((c) => c.mode !== "HIDDEN").map((c) => c.slot as 1 | 2 | 3 | 4);
  const intra = h.taxType === "INTRA";
  const gst = Number(h.gstAmount);
  const transportCharges = charges.filter((c) => c.chargeType === "FREIGHT");
  const otherCharges = charges.filter((c) => c.chargeType === "OTHER");

  const title = h.grnNo ?? `Draft #${h.id}`;
  const watermark = h.status === "CANCELLED" ? "CANCELLED" : h.status === "DRAFT" ? "DRAFT" : null;

  const th = "border border-black/60 px-1.5 py-1 text-left font-semibold";
  const td = "border border-black/40 px-1.5 py-1 align-top";
  const num = `${td} text-right tabular-nums`;

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        @media print { .no-print { display: none !important; } .page { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; } }
        .page { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; }
        thead { display: table-header-group; }
        tr { break-inside: avoid; }
      `}</style>
      <PrintToolbar title={`${title} · Fatura Desk`} label={title} autoPrint={auto === "1"} />

      <div className="page relative mx-auto my-4 w-[210mm] bg-white p-[10mm] shadow-lg">
        {watermark && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-30 text-[90pt] font-bold tracking-widest text-black/[0.07]">{watermark}</span>
          </div>
        )}

        {/* Company + title */}
        <div className="flex items-start gap-4 border-b-2 border-black pb-2">
          {company?.logoPath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uploadUrl(company.logoPath)!} alt="" className="max-h-[18mm] max-w-[35mm] object-contain" />
          )}
          <div className="flex-1">
            <p className="text-[14pt] font-bold uppercase">{company?.name ?? "Company name not set"}</p>
            {company?.address && <p className="whitespace-pre-line">{company.address}</p>}
            <p>
              {company?.gstin && <>GSTIN: <strong>{company.gstin}</strong> · </>}
              {company?.stateCode && <>State: {stateName(company.stateCode)} ({company.stateCode})</>}
              {company?.phone && <> · Ph: {company.phone}</>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[13pt] font-bold">GOODS RECEIPT NOTE</p>
            <p className="font-mono text-[11pt] font-semibold">{title}</p>
            <p>Date: {formatDate(h.grnDate)}</p>
            {h.status !== "SAVED" && <p className="font-bold">{h.status}</p>}
          </div>
        </div>

        {/* Supplier / receipt details */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="border border-black/60 p-2">
            <p className="text-[8pt] font-semibold uppercase text-black/70">Supplier</p>
            <p className="font-bold">{supplier?.name}</p>
            {supplier?.address && <p className="whitespace-pre-line">{supplier.address}</p>}
            <p>
              {supplier?.gstin ? <>GSTIN: <strong>{supplier.gstin}</strong></> : "Unregistered"} · State: {stateName(supplier?.stateCode)} ({supplier?.stateCode})
            </p>
            {supplier?.phone && <p>Ph: {supplier.phone}</p>}
          </div>
          <div className="border border-black/60 p-2">
            <p className="text-[8pt] font-semibold uppercase text-black/70">Receipt details</p>
            <table className="w-full">
              <tbody>
                <tr><td className="pr-2 text-black/70">Received at</td><td className="font-semibold">{location?.name} ({stateName(location?.stateCode)})</td></tr>
                <tr><td className="pr-2 text-black/70">Supplier invoice</td><td><strong>{h.invoiceNo}</strong> dt. {formatDate(h.invoiceDate)}</td></tr>
                <tr><td className="pr-2 text-black/70">Invoice value</td><td className="font-semibold">₹{amt(h.invoiceValue)}</td></tr>
                {transport[0] && <tr><td className="pr-2 text-black/70">Transport</td><td>{transport[0].name}{h.lrNo && ` · LR ${h.lrNo}`}{h.transportDate && ` dt. ${formatDate(h.transportDate)}`}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Items (no item-wise GST — GST is entered for the whole bill) */}
        <table className="mt-2 w-full border-collapse text-[8pt]">
          <thead className="bg-black/5">
            <tr>
              <th className={th}>#</th>
              <th className={th}>Item</th>
              <th className={th}>HSN</th>
              <th className={th}>Barcode</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} text-right`}>Rate</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={`${th} text-right`}>Disc.</th>
              <th className={`${th} text-right`}>Taxable</th>
              <th className={`${th} text-right`}>MRP</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const cats = visibleSlots.map((s) => valueName.get(l[`cat${s}ValueId`] as number)).filter(Boolean).join(" / ");
              return (
                <tr key={l.id}>
                  <td className={num}>{l.lineNo}</td>
                  <td className={td}>
                    <span className="font-semibold">{l.itemName}</span>
                    <span className="block text-[7pt] text-black/70">
                      {deptName.get(l.departmentId)}
                      {cats && ` · ${cats}`}
                    </span>
                  </td>
                  <td className={td}>{l.hsnCode}</td>
                  <td className={`${td} font-mono`}>{l.barcode ?? "—"}</td>
                  <td className={num}>{l.qty}</td>
                  <td className={num}>{amt(l.purchaseRate)}</td>
                  <td className={num}>{amt(l.amount)}</td>
                  <td className={num}>{Number(l.discountAmount) ? amt(l.discountAmount) : ""}</td>
                  <td className={num}>{amt(l.taxableValue)}</td>
                  <td className={num}>{amt(l.mrp)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className={td} colSpan={4}>Total ({lines.length} lines)</td>
              <td className={num}>{h.totalQty}</td>
              <td className={td} />
              <td className={num}>{amt(h.grossAmount)}</td>
              <td className={num}>{Number(h.discountAmount) ? amt(h.discountAmount) : ""}</td>
              <td className={num}>{amt(h.taxableValue)}</td>
              <td className={td} />
            </tr>
          </tfoot>
        </table>

        {/* Words / remarks + totals */}
        <div className="mt-2 grid grid-cols-[1fr_80mm] gap-2">
          <div>
            <p className="border border-black/40 p-1.5">
              <span className="text-black/70">Amount in words: </span>
              <strong>{rupeesInWords(h.netPayable)}</strong>
            </p>
            {h.remarks && (
              <p className="mt-2 border border-black/40 p-1.5">
                <span className="text-black/70">Remarks: </span>
                {h.remarks}
              </p>
            )}
            {h.status === "CANCELLED" && (
              <p className="mt-2 border border-black p-1.5 font-semibold">
                CANCELLED {h.cancelledAt && `on ${formatDateTime(h.cancelledAt)}`} — {h.cancelReason}
              </p>
            )}
          </div>
          <table className="w-full border-collapse self-start text-[8.5pt]">
            <tbody>
              <tr><td className={td}>Gross Amount</td><td className={num}>{amt(h.grossAmount)}</td></tr>
              {Number(h.discountAmount) > 0 && (
                <tr>
                  <td className={td}>Discount {h.discountType === "PERCENT" && `(${Number(h.discountValue)}%)`}</td>
                  <td className={num}>−₹{amt(h.discountAmount)}</td>
                </tr>
              )}
              <tr className="font-semibold"><td className={td}>Taxable Value</td><td className={num}>{amt(h.taxableValue)}</td></tr>
              {gst > 0 ? (
                <>
                  <tr>
                    <td className={td}>GST {h.gstMode === "PERCENT" && `(${Number(h.gstInput)}%)`}</td>
                    <td className={num}>{amt(h.gstAmount)}</td>
                  </tr>
                  {intra ? (
                    <>
                      <tr className="text-[7.5pt] text-black/70"><td className={`${td} pl-4`}>CGST (50%)</td><td className={num}>{amt(h.cgstAmount)}</td></tr>
                      <tr className="text-[7.5pt] text-black/70"><td className={`${td} pl-4`}>SGST (50%)</td><td className={num}>{amt(h.sgstAmount)}</td></tr>
                    </>
                  ) : (
                    <tr className="text-[7.5pt] text-black/70"><td className={`${td} pl-4`}>IGST (100%)</td><td className={num}>{amt(h.igstAmount)}</td></tr>
                  )}
                </>
              ) : (
                <tr><td className={td}>GST</td><td className={num}>Nil</td></tr>
              )}
              {transportCharges.map((c) => (
                <tr key={c.id}><td className={td}>Transport / Freight</td><td className={num}>{signedInr(c.amount)}</td></tr>
              ))}
              {otherCharges.map((c) => (
                <tr key={c.id}><td className={td}>{c.description || "Other charges"}</td><td className={num}>{signedInr(c.amount)}</td></tr>
              ))}
              {Number(h.roundOff) !== 0 && <tr><td className={td}>Round Off</td><td className={num}>{Number(h.roundOff) > 0 ? "+" : ""}{signedInr(h.roundOff)}</td></tr>}
              <tr className="bg-black/5 text-[10pt] font-bold"><td className={td}>Net Payable</td><td className={num}>₹{amt(h.netPayable)}</td></tr>
            </tbody>
          </table>
        </div>

        {/* Signatures */}
        <div className="mt-10 grid grid-cols-3 gap-6 text-center text-[8pt]">
          <div className="border-t border-black pt-1">Received by</div>
          <div className="border-t border-black pt-1">Checked by</div>
          <div className="border-t border-black pt-1">Authorised signatory</div>
        </div>

        <div className="mt-6 flex justify-between border-t border-black/30 pt-1 text-[7pt] text-black/60">
          <span>Entered by {createdBy?.name ?? "—"}{h.savedAt && ` · saved ${formatDateTime(h.savedAt)}`}</span>
          <span>Generated by Fatura Desk · {formatDateTime(new Date())}</span>
        </div>
      </div>
    </>
  );
}
