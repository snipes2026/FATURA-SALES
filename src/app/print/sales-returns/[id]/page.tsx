import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadReturn, type LoadedReturn } from "@/app/(app)/sales-returns/_lib/load-return";
import { PrintToolbar } from "@/components/print-toolbar";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatAmount, stateName } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { uploadUrl } from "@/lib/uploads";
import { balanceLabel } from "@/lib/validation/sales";
import { rupeesInWords } from "@/lib/words";

export const metadata: Metadata = { title: "Credit Note" };

const amt = (v: string | number) => formatAmount(v);
const p2 = (p: number) => formatAmount(fromPaise(p));
const signed = (v: string) => (toPaise(v) < 0 ? `−${amt(-Number(v))}` : `+${amt(v)}`);
function bal(v: string) {
  const p = toPaise(v);
  const b = balanceLabel(p);
  return b.side === "NIL" ? "Nil" : `₹${p2(Math.abs(p))} ${b.side === "DR" ? "Dr" : "Cr"}`;
}

/** Credit note print: A4 or 80mm thermal (default from Settings → Sales & Payments; ?format= overrides). */
export default async function CreditNotePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string; format?: string }>;
}) {
  const user = await requirePermission("salesReturn.view");
  const id = Number((await params).id);
  const { auto, format } = await searchParams;
  if (!Number.isInteger(id) || id <= 0) notFound();
  const r = await loadReturn(id);
  if (!r || !user.locations.some((l) => l.id === r.h.locationId)) notFound();

  const fmt = format === "A4" || format === "THERMAL80" ? format : r.printFormat;
  const other = fmt === "A4" ? "THERMAL80" : "A4";

  return (
    <>
      <PrintToolbar title={`${r.h.returnNo} · Fatura Desk`} label={r.h.returnNo} subtitle={fmt === "A4" ? "A4 · Credit Note" : "80mm · Credit Note"} autoPrint={auto === "1"}>
        <Link href={`/print/sales-returns/${id}?format=${other}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
          {other === "A4" ? "A4 format" : "80mm format"}
        </Link>
      </PrintToolbar>
      {fmt === "A4" ? <A4CreditNote r={r} /> : <ThermalCreditNote r={r} />}
    </>
  );
}

/** "Applied to INV/… ₹3,000" rows, advance, refund. */
function settlement(r: LoadedReturn) {
  const rows: { k: string; v: string }[] = r.applied.map((a) => ({ k: `Adjusted against ${a.ref}${a.date ? ` (${formatDate(a.date)})` : ""}`, v: p2(a.amount) }));
  if (toPaise(r.h.advanceCreated) > 0) rows.push({ k: "Kept as advance", v: amt(r.h.advanceCreated) });
  if (toPaise(r.h.refundAmount) > 0) rows.push({ k: `Refunded (${r.refundLabel})`, v: amt(r.h.refundAmount) });
  return rows;
}

// ------------------------------------------------------------------ A4
function A4CreditNote({ r }: { r: LoadedReturn }) {
  const { h, lines, company, location, against, breakup } = r;
  const intra = h.taxType === "INTRA";
  const cancelled = h.status === "CANCELLED";
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
      <div className="page relative mx-auto my-4 w-[210mm] bg-white p-[10mm] shadow-lg">
        {cancelled && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-30 text-[90pt] font-bold tracking-widest text-black/[0.07]">CANCELLED</span>
          </div>
        )}

        <div className="flex items-start gap-4 border-b-2 border-black pb-2">
          {company?.logoPath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={uploadUrl(company.logoPath)!} alt="" className="max-h-[18mm] max-w-[35mm] object-contain" />
          )}
          <div className="flex-1">
            <p className="text-[14pt] font-bold uppercase">{company?.name ?? "Company name not set"}</p>
            {company?.address && <p className="whitespace-pre-line">{company.address}</p>}
            <p>
              {company?.gstin && (
                <>
                  GSTIN: <strong>{company.gstin}</strong> ·{" "}
                </>
              )}
              {company?.stateCode && (
                <>
                  State: {stateName(company.stateCode)} ({company.stateCode})
                </>
              )}
              {company?.phone && <> · Ph: {company.phone}</>}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[13pt] font-bold">CREDIT NOTE</p>
            <p className="font-mono text-[11pt] font-semibold">{h.returnNo}</p>
            <p>Date: {formatDate(h.returnDate)}</p>
            {cancelled && <p className="font-bold">CANCELLED</p>}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="border border-black/60 p-2">
            <p className="text-[8pt] font-semibold uppercase text-black/70">Customer</p>
            <p className="font-bold">{h.customerName}</p>
            {h.customerAddress && <p className="whitespace-pre-line">{h.customerAddress}</p>}
            <p>
              {h.customerGstin ? (
                <>
                  GSTIN: <strong>{h.customerGstin}</strong>
                </>
              ) : (
                "Unregistered"
              )}{" "}
              · State: {stateName(h.customerStateCode)} ({h.customerStateCode})
            </p>
            {h.customerPhone && <p>Ph: {h.customerPhone}</p>}
          </div>
          <div className="border border-black/60 p-2">
            <table className="w-full">
              <tbody>
                <tr>
                  <td className="pr-2 text-black/70">Credit note no.</td>
                  <td className="font-semibold">{h.returnNo}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-black/70">Date</td>
                  <td>{formatDate(h.returnDate)}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-black/70">Original invoice</td>
                  <td className="font-semibold">{against ? `${against.billNo} dated ${formatDate(against.billDate)}` : "—"}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-black/70">Place of supply</td>
                  <td>
                    {stateName(h.customerStateCode)} ({h.customerStateCode})
                  </td>
                </tr>
                <tr>
                  <td className="pr-2 text-black/70">Goods received at</td>
                  <td>{location?.name}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-black/70">Prices</td>
                  <td>{h.gstMode === "INCLUDES" ? "Inclusive of GST" : "GST extra"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <table className="mt-2 w-full border-collapse text-[8pt]">
          <thead className="bg-black/5">
            <tr>
              <th className={th}>#</th>
              <th className={th}>Barcode</th>
              <th className={th}>Item</th>
              <th className={th}>HSN</th>
              <th className={`${th} text-right`}>GST %</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} text-right`}>Rate</th>
              <th className={`${th} text-right`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className={num}>{l.lineNo}</td>
                <td className={`${td} font-mono`}>{l.barcode}</td>
                <td className={td}>{l.itemName}</td>
                <td className={td}>{l.hsnCode}</td>
                <td className={num}>{h.gstOverridden ? "—" : `${Number(l.gstRate)}%`}</td>
                <td className={num}>{l.qty}</td>
                <td className={num}>{amt(l.rate)}</td>
                <td className={num}>{amt(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className={td} colSpan={5}>
                Total ({lines.length} {lines.length === 1 ? "line" : "lines"})
              </td>
              <td className={num}>{h.totalQty}</td>
              <td className={td} />
              <td className={num}>{amt(h.gross)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="mt-2 grid grid-cols-[1fr_75mm] gap-2">
          <div className="space-y-2">
            {h.gstOverridden ? (
              <p className="border border-black/40 p-1.5">GST (entered): ₹{amt(h.gstAmount)}</p>
            ) : (
              <table className="w-full border-collapse text-[7.5pt]">
                <thead className="bg-black/5">
                  <tr>
                    <th className={th}>HSN</th>
                    <th className={`${th} text-right`}>Rate</th>
                    <th className={`${th} text-right`}>Taxable</th>
                    {intra ? (
                      <>
                        <th className={`${th} text-right`}>CGST</th>
                        <th className={`${th} text-right`}>SGST</th>
                      </>
                    ) : (
                      <th className={`${th} text-right`}>IGST</th>
                    )}
                    <th className={`${th} text-right`}>Total tax</th>
                  </tr>
                </thead>
                <tbody>
                  {breakup.map((b) => (
                    <tr key={`${b.hsn}-${b.rate}`}>
                      <td className={td}>{b.hsn}</td>
                      <td className={num}>{b.rate}%</td>
                      <td className={num}>{p2(b.taxable)}</td>
                      {intra ? (
                        <>
                          <td className={num}>
                            {p2(b.cgst)} <span className="text-black/60">@{b.rate / 2}%</span>
                          </td>
                          <td className={num}>
                            {p2(b.sgst)} <span className="text-black/60">@{b.rate / 2}%</span>
                          </td>
                        </>
                      ) : (
                        <td className={num}>{p2(b.igst)}</td>
                      )}
                      <td className={num}>{p2(b.gst)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="border border-black/40 p-1.5">
              <span className="text-black/70">Amount in words: </span>
              <strong>{rupeesInWords(h.netAmount)}</strong>
            </p>

            <div className="grid grid-cols-2 gap-2 text-[8pt]">
              <table className="w-full self-start border-collapse">
                <tbody>
                  <tr className="bg-black/5">
                    <td className={`${td} font-semibold`} colSpan={2}>
                      Settled as
                    </td>
                  </tr>
                  {settlement(r).map((x) => (
                    <tr key={x.k}>
                      <td className={td}>{x.k}</td>
                      <td className={num}>{x.v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="w-full self-start border-collapse">
                <tbody>
                  <tr className="bg-black/5">
                    <td className={`${td} font-semibold`} colSpan={2}>
                      Account
                    </td>
                  </tr>
                  <tr>
                    <td className={td}>Previous balance</td>
                    <td className={num}>{bal(h.prevBalance)}</td>
                  </tr>
                  <tr>
                    <td className={td}>This credit note</td>
                    <td className={num}>₹{amt(h.netAmount)} Cr</td>
                  </tr>
                  {toPaise(h.refundAmount) > 0 && (
                    <tr>
                      <td className={td}>Refunded</td>
                      <td className={num}>₹{amt(h.refundAmount)}</td>
                    </tr>
                  )}
                  <tr className="font-bold">
                    <td className={td}>New balance</td>
                    <td className={num}>{bal(h.balanceAfter)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {cancelled && (
              <p className="border border-black p-1.5 font-semibold">
                CANCELLED {h.cancelledAt && `on ${formatDateTime(h.cancelledAt)}`} — {h.cancelReason}
              </p>
            )}
          </div>

          <table className="w-full self-start border-collapse text-[8.5pt]">
            <tbody>
              <tr>
                <td className={td}>Gross Amount</td>
                <td className={num}>{amt(h.gross)}</td>
              </tr>
              <tr>
                <td className={td}>Taxable Value</td>
                <td className={num}>{amt(h.taxable)}</td>
              </tr>
              {intra ? (
                <>
                  <tr>
                    <td className={td}>CGST</td>
                    <td className={num}>{amt(h.cgst)}</td>
                  </tr>
                  <tr>
                    <td className={td}>SGST</td>
                    <td className={num}>{amt(h.sgst)}</td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td className={td}>IGST</td>
                  <td className={num}>{amt(h.igst)}</td>
                </tr>
              )}
              {toPaise(h.roundOff) !== 0 && (
                <tr>
                  <td className={td}>Round Off</td>
                  <td className={num}>{signed(h.roundOff)}</td>
                </tr>
              )}
              <tr className="bg-black/5 text-[10pt] font-bold">
                <td className={td}>Net Return Value</td>
                <td className={num}>₹{amt(h.netAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-10 text-[8pt]">
          <div className="border-t border-black pt-1">Customer&apos;s signature</div>
          <div className="border-t border-black pt-1 text-right">
            For <strong>{company?.name}</strong> — Authorised signatory
          </div>
        </div>

        <div className="mt-6 flex justify-between border-t border-black/30 pt-1 text-[7pt] text-black/60">
          <span>
            Entered by {r.createdBy} · {formatDateTime(h.createdAt)}
          </span>
          <span>Generated by Fatura Desk</span>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ 80mm thermal
function ThermalCreditNote({ r }: { r: LoadedReturn }) {
  const { h, lines, company, against, breakup } = r;
  const intra = h.taxType === "INTRA";
  const row = "flex justify-between gap-2";
  const rule = "my-1 border-t border-dashed border-black";

  return (
    <>
      <style>{`
        @page { size: 80mm auto; margin: 3mm; }
        @media print { .no-print { display: none !important; } .slip { box-shadow: none !important; margin: 0 !important; } }
        .slip { font-family: "Courier New", ui-monospace, monospace; font-size: 9pt; line-height: 1.25; color: #000; }
      `}</style>
      <div className="slip mx-auto my-4 w-[74mm] bg-white p-[2mm] shadow-lg">
        <div className="text-center">
          <p className="text-[11pt] font-bold uppercase">{company?.name}</p>
          {company?.address && <p className="whitespace-pre-line text-[8pt]">{company.address}</p>}
          {company?.gstin && <p className="text-[8pt]">GSTIN {company.gstin}</p>}
          {company?.phone && <p className="text-[8pt]">Ph {company.phone}</p>}
          <p className="mt-1 font-bold">CREDIT NOTE{h.status === "CANCELLED" ? " — CANCELLED" : ""}</p>
        </div>
        <div className={rule} />
        <div className={row}>
          <span>{h.returnNo}</span>
          <span>{formatDate(h.returnDate)}</span>
        </div>
        {against && (
          <p className="text-[8pt]">
            Against {against.billNo} dt {formatDate(against.billDate)}
          </p>
        )}
        <p>
          {h.customerName}
          {h.customerPhone && ` · ${h.customerPhone}`}
        </p>
        {h.customerGstin && <p className="text-[8pt]">GSTIN {h.customerGstin}</p>}
        <div className={rule} />
        {lines.map((l) => (
          <div key={l.id} className="mb-0.5">
            <p className="truncate">{l.itemName}</p>
            <div className={row}>
              <span className="text-[8pt]">
                {l.barcode} · {l.qty} × {amt(l.rate)}
              </span>
              <span>{amt(l.amount)}</span>
            </div>
          </div>
        ))}
        <div className={rule} />
        <div className={row}>
          <span>
            Items {lines.length} · Qty {h.totalQty}
          </span>
          <span>{amt(h.gross)}</span>
        </div>
        {h.gstOverridden ? (
          <div className={row}>
            <span>GST</span>
            <span>{amt(h.gstAmount)}</span>
          </div>
        ) : (
          breakup.map((b) => (
            <div key={`${b.hsn}-${b.rate}`} className={`${row} text-[8pt]`}>
              <span>
                {intra ? `CGST+SGST ${b.rate / 2}+${b.rate / 2}%` : `IGST ${b.rate}%`} on {p2(b.taxable)}
              </span>
              <span>{p2(b.gst)}</span>
            </div>
          ))
        )}
        {toPaise(h.roundOff) !== 0 && (
          <div className={row}>
            <span>Round off</span>
            <span>{signed(h.roundOff)}</span>
          </div>
        )}
        <div className={`${row} text-[11pt] font-bold`}>
          <span>RETURN VALUE</span>
          <span>₹{amt(h.netAmount)}</span>
        </div>
        <div className={rule} />
        {settlement(r).map((x) => (
          <div key={x.k} className={`${row} text-[8pt]`}>
            <span>{x.k}</span>
            <span>{x.v}</span>
          </div>
        ))}
        <div className={rule} />
        <div className={row}>
          <span>Previous balance</span>
          <span>{bal(h.prevBalance)}</span>
        </div>
        <div className={`${row} font-bold`}>
          <span>New balance</span>
          <span>{bal(h.balanceAfter)}</span>
        </div>
        <div className={rule} />
        <p className="text-center text-[8pt]">{rupeesInWords(h.netAmount)}</p>
        <p className="mt-1 text-center text-[8pt]">Generated by Fatura Desk</p>
      </div>
    </>
  );
}
