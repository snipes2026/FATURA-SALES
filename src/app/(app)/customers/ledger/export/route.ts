import ExcelJS from "exceljs";
import { db } from "@/db";
import { formatDate } from "@/lib/dates";
import { fromPaise } from "@/lib/money";
import { can } from "@/lib/permissions";
import { customerLedger, VOUCHER_LABEL } from "@/lib/sales/ledger";
import { getCurrentUser } from "@/lib/session";
import { readLedgerParams } from "../../_lib/params";

const num = (p: number) => Number(fromPaise(p));
const drCr = (p: number) => (p === 0 ? "Nil" : p > 0 ? "Dr" : "Cr");

/** Customer ledger as .xlsx (same figures as the screen). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, "sales.view")) return new Response("Not allowed", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const { customer, from, to } = await readLedgerParams(sp);
  if (!customer) return new Response("Choose a customer", { status: 400 });
  const ledger = await customerLedger(db, customer.id, from, to);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Fatura Desk";
  const ws = wb.addWorksheet("Ledger", { views: [{ state: "frozen", ySplit: 4 }] });
  ws.columns = [
    { key: "date", width: 13 },
    { key: "type", width: 15 },
    { key: "no", width: 18 },
    { key: "part", width: 50 },
    { key: "dr", width: 14, style: { numFmt: "#,##,##0.00" } },
    { key: "cr", width: 14, style: { numFmt: "#,##,##0.00" } },
    { key: "bal", width: 14, style: { numFmt: "#,##,##0.00" } },
    { key: "side", width: 6 },
  ];
  ws.addRow([`Customer Ledger — ${customer.name}`]).font = { bold: true, size: 13 };
  ws.addRow([`${customer.phone}${customer.gstin ? ` · GSTIN ${customer.gstin}` : ""} · ${formatDate(from)} to ${formatDate(to)}`]);
  ws.addRow([]);
  const head = ws.addRow(["Date", "Voucher Type", "Voucher No.", "Particulars", "Debit", "Credit", "Balance", "Dr/Cr"]);
  head.font = { bold: true };
  head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF2F6" } }));

  const op = ws.addRow([formatDate(from), "Opening", "", `Opening balance as of ${formatDate(from)}`, ledger.opening > 0 ? num(ledger.opening) : null, ledger.opening < 0 ? num(-ledger.opening) : null, num(Math.abs(ledger.opening)), drCr(ledger.opening)]);
  op.font = { italic: true };
  for (const e of ledger.entries)
    ws.addRow([formatDate(e.date), VOUCHER_LABEL[e.type] ?? e.type, e.voucherNo ?? "", e.particulars, e.debit ? num(e.debit) : null, e.credit ? num(e.credit) : null, num(Math.abs(e.balance)), drCr(e.balance)]);
  ws.addRow(["", "", "", "Total for the period", num(ledger.totalDebit), num(ledger.totalCredit)]).font = { bold: true };
  ws.addRow(["", "", "", `Closing balance as of ${formatDate(to)}`, null, null, num(Math.abs(ledger.closing)), drCr(ledger.closing)]).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  const safe = customer.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "customer";
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ledger-${safe}-${from}-to-${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
