import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadBill, type LoadedBill } from "@/app/(app)/sales/_lib/load-bill";
import { PrintToolbar } from "@/components/print-toolbar";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatAmount, stateName } from "@/lib/india";
import { fromPaise, toPaise } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { uploadUrl } from "@/lib/uploads";
import { balanceLabel } from "@/lib/validation/sales";
import { rupeesInWords } from "@/lib/words";

export const metadata: Metadata = { title: "Tax Invoice" };

const amt = (v: string | number) => formatAmount(v);
const p2 = (p: number) => formatAmount(fromPaise(p));
const signed = (v: string) => (toPaise(v) < 0 ? `−${amt(-Number(v))}` : `+${amt(v)}`);
function bal(v: string) {
  const p = toPaise(v);
  const b = balanceLabel(p);
  return b.side === "NIL" ? "Nil" : `₹${p2(Math.abs(p))} ${b.side === "DR" ? "Dr" : "Cr"}`;
}

/** Sales bill print: A4 Tax Invoice or 80mm thermal receipt (default from Settings → Sales & Payments; ?format= overrides). */
export default async function SalesPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string; format?: string }>;
}) {
  const user = await requirePermission("sales.view");
  const id = Number((await params).id);
  const { auto, format } = await searchParams;
  if (!Number.isInteger(id) || id <= 0) notFound();
  const bill = await loadBill(id);
  if (!bill || !user.locations.some((l) => l.id === bill.h.locationId)) notFound();

  const fmt = format === "A4" || format === "THERMAL80" ? format : bill.printFormat;
  const other = fmt === "A4" ? "THERMAL80" : "A4";

  return (
    <>
      <PrintToolbar
        title={`${bill.h.billNo} · Fatura Desk`}
        label={bill.h.billNo}
        subtitle={fmt === "A4" ? "A4 · Tax Invoice" : "80mm · Receipt"}
        autoPrint={auto === "1"}
      >
        <Link href={`/print/sales/${id}?format=${other}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
          {other === "A4" ? "A4 format" : "80mm format"}
        </Link>
      </PrintToolbar>
      {fmt === "A4" ? <A4Invoice bill={bill} /> : <ThermalReceipt bill={bill} />}
    </>
  );
}

// ------------------------------------------------------------------ A4
function A4Invoice({ bill }: { bill: LoadedBill }) {
  const { h, lines, company, location, payments, breakup } = bill;
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
            <p className="text-[13pt] font-bold">TAX INVOICE</p>
            <p className="font-mono text-[11pt] font-semibold">{h.billNo}</p>
            <p>Date: {formatDate(h.billDate)}</p>
            {cancelled && <p className="font-bold">CANCELLED</p>}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="border border-black/60 p-2">
            <p className="text-[8pt] font-semibold uppercase text-black/70">Bill to</p>
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
                  <td className="pr-2 text-black/70">Invoice no.</td>
                  <td className="font-semibold">{h.billNo}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-black/70">Invoice date</td>
                  <td>{formatDate(h.billDate)}</td>
                </tr>
                <tr>
                  <td className="pr-2 text-black/70">Place of supply</td>
                  <td>
                    {stateName(h.customerStateCode)} ({h.customerStateCode})
                  </td>
                </tr>
                <tr>
                  <td className="pr-2 text-black/70">Billed from</td>
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
              <p className="border border-black/40 p-1.5">GST (entered on the bill): ₹{amt(h.gstAmount)}</p>
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

            {/* Payment by mode + account position */}
            <div className="grid grid-cols-2 gap-2 text-[8pt]">
              <table className="w-full self-start border-collapse">
                <tbody>
                  <tr className="bg-black/5">
                    <td className={`${td} font-semibold`} colSpan={2}>
                      Payment
                    </td>
                  </tr>
                  {toPaise(h.cashTendered) > 0 && (
                    <tr>
                      <td className={td}>{toPaise(h.changeReturned) > 0 ? "Cash tendered" : "Cash"}</td>
                      <td className={num}>{amt(h.cashTendered)}</td>
                    </tr>
                  )}
                  {toPaise(h.changeReturned) > 0 && (
                    <tr>
                      <td className={td}>Change returned</td>
                      <td className={num}>{amt(h.changeReturned)}</td>
                    </tr>
                  )}
                  {payments
                    .filter((x) => x.mode !== "CASH")
                    .map((x) => (
                      <tr key={x.mode}>
                        <td className={td}>{x.label}</td>
                        <td className={num}>{p2(x.amount)}</td>
                      </tr>
                    ))}
                  {toPaise(h.advanceUsed) > 0 && (
                    <tr>
                      <td className={td}>Advance adjusted</td>
                      <td className={num}>{amt(h.advanceUsed)}</td>
                    </tr>
                  )}
                  <tr>
                    <td className={td}>Credit</td>
                    <td className={num}>{toPaise(h.creditAmount) > 0 ? amt(h.creditAmount) : "—"}</td>
                  </tr>
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
                    <td className={td}>This bill</td>
                    <td className={num}>₹{amt(h.netAmount)}</td>
                  </tr>
                  <tr>
                    <td className={td}>Received</td>
                    <td className={num}>₹{p2(bill.received)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td className={td}>New balance</td>
                    <td className={num}>{bal(h.balanceAfter)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {h.status === "CANCELLED" && (
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
                <td className={td}>Net Amount</td>
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
            Billed by {bill.createdBy} · {formatDateTime(h.createdAt)}
            {bill.receipt && ` · Receipt ${bill.receipt.receiptNo}`}
          </span>
          <span>Generated by Fatura Desk</span>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ 80mm thermal
function ThermalReceipt({ bill }: { bill: LoadedBill }) {
  const { h, lines, company, payments, breakup } = bill;
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
          <p className="mt-1 font-bold">TAX INVOICE{h.status === "CANCELLED" ? " — CANCELLED" : ""}</p>
        </div>
        <div className={rule} />
        <div className={row}>
          <span>{h.billNo}</span>
          <span>{formatDate(h.billDate)}</span>
        </div>
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
          <span>Items {lines.length} · Qty {h.totalQty}</span>
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
        {h.gstMode === "ADD" && (
          <div className={row}>
            <span>GST total</span>
            <span>{amt(h.gstAmount)}</span>
          </div>
        )}
        {toPaise(h.roundOff) !== 0 && (
          <div className={row}>
            <span>Round off</span>
            <span>{signed(h.roundOff)}</span>
          </div>
        )}
        <div className={`${row} text-[11pt] font-bold`}>
          <span>NET</span>
          <span>₹{amt(h.netAmount)}</span>
        </div>
        {h.gstMode === "INCLUDES" && <p className="text-[7.5pt]">Prices include GST</p>}
        <div className={rule} />
        {toPaise(h.cashTendered) > 0 && (
          <div className={row}>
            <span>Cash</span>
            <span>{amt(h.cashTendered)}</span>
          </div>
        )}
        {toPaise(h.changeReturned) > 0 && (
          <div className={row}>
            <span>Change</span>
            <span>{amt(h.changeReturned)}</span>
          </div>
        )}
        {payments
          .filter((x) => x.mode !== "CASH")
          .map((x) => (
            <div key={x.mode} className={row}>
              <span>{x.label}</span>
              <span>{p2(x.amount)}</span>
            </div>
          ))}
        {toPaise(h.advanceUsed) > 0 && (
          <div className={row}>
            <span>Advance adjusted</span>
            <span>{amt(h.advanceUsed)}</span>
          </div>
        )}
        {toPaise(h.creditAmount) > 0 && (
          <div className={row}>
            <span>Credit</span>
            <span>{amt(h.creditAmount)}</span>
          </div>
        )}
        <div className={rule} />
        <div className={row}>
          <span>Previous balance</span>
          <span>{bal(h.prevBalance)}</span>
        </div>
        <div className={row}>
          <span>This bill</span>
          <span>₹{amt(h.netAmount)}</span>
        </div>
        <div className={row}>
          <span>Received</span>
          <span>₹{p2(bill.received)}</span>
        </div>
        <div className={`${row} font-bold`}>
          <span>New balance</span>
          <span>{bal(h.balanceAfter)}</span>
        </div>
        <div className={rule} />
        <p className="text-center text-[8pt]">{rupeesInWords(h.netAmount)}</p>
        <p className="mt-1 text-center text-[8pt]">Thank you! · Generated by Fatura Desk</p>
      </div>
    </>
  );
}
