/**
 * Sales Returns in the Customer Ledger and Outstanding Bills: Sales Return Cr
 * rows with their particulars, Refund Dr rows, the running balance, which
 * document each voucher no. opens, and pending amounts reduced by returns.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { runMigrations, seedBasics, startTestDb } from "./helpers/test-db";

let stop: () => Promise<void>;
let c: pg.Client;
let ids: Awaited<ReturnType<typeof seedBasics>>;
let productId: number;
let walkinId: number;
let app: {
  db: typeof import("../src/db").db;
  pool: typeof import("../src/db").pool;
  saveSale: typeof import("../src/app/(app)/sales/_lib/save-sale").saveSale;
  saveReceipt: typeof import("../src/app/(app)/receipts/_lib/save-receipt").saveReceipt;
  saveReturn: typeof import("../src/app/(app)/sales-returns/_lib/save-return").saveReturn;
  cancelSale: typeof import("../src/lib/sales/cancel").cancelSale;
  v: typeof import("../src/lib/validation/sales");
  rv: typeof import("../src/lib/validation/sales-return");
  ledger: typeof import("../src/lib/sales/ledger");
  todayIST: typeof import("../src/lib/dates").todayIST;
};

before(async () => {
  const t = await startTestDb();
  stop = t.stop;
  await runMigrations(t.url);
  ids = await seedBasics(t.url);
  process.env.DATABASE_URL = t.url;
  process.env.DB_POOL_MAX = "1";
  const dbm = await import("../src/db");
  app = {
    db: dbm.db,
    pool: dbm.pool,
    saveSale: (await import("../src/app/(app)/sales/_lib/save-sale")).saveSale,
    saveReceipt: (await import("../src/app/(app)/receipts/_lib/save-receipt")).saveReceipt,
    saveReturn: (await import("../src/app/(app)/sales-returns/_lib/save-return")).saveReturn,
    cancelSale: (await import("../src/lib/sales/cancel")).cancelSale,
    v: await import("../src/lib/validation/sales"),
    rv: await import("../src/lib/validation/sales-return"),
    ledger: await import("../src/lib/sales/ledger"),
    todayIST: (await import("../src/lib/dates")).todayIST,
  };
  c = new pg.Client(t.url);
  await c.connect();
  productId = (await one(`insert into products (department_id, item_name, barcode, purchase_rate, wsp, mrp) values ($1,'Kurta','T000001',500,1000,1999) returning id`, [ids.deptId])).id;
  await c.query(`insert into stock_ledger (location_id, product_id, qty_in, ref_doc_type, ref_doc_id, created_by) values ($1,$2,500,'GRN',1,$3)`, [ids.locationId, productId, ids.userId]);
  walkinId = (await one(`insert into customers (name, phone, state_code, opening_date, is_walkin) values ('Walk-in Customer','0','27','2026-04-01',true) returning id`)).id;
});

after(async () => {
  await c.end();
  await app.pool.end();
  await stop();
});

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
const user = () => ({ id: ids.userId, locations: [{ id: ids.locationId, name: "Main Store", type: "STORE" as const, stateCode: "27" }] });
const tx = <T>(fn: (t: Parameters<Parameters<typeof app.db.transaction>[0]>[0]) => Promise<T>) => app.db.transaction(fn);
const customer = async () => (await one(`insert into customers (name, phone, state_code, opening_date) values ($1,'98','27','2026-04-01') returning id`, [`C ${Math.random()}`])).id as number;
const pay = (cash = "") => ({ cash, bank1: "", bank2: "", advanceUsed: null, manual: null, excess: null });

const sale = (customerId: number, qty: number, cash = "") =>
  tx((t) =>
    app.saveSale(
      t,
      app.v.saleSaveSchema.parse({
        customerId,
        locationId: ids.locationId,
        billDate: app.todayIST(),
        gstMode: "INCLUDES",
        gstOverride: null,
        roundOff: null,
        lines: [{ productId, qty, rate: "1000.00" }],
        payment: pay(cash),
        expectedNet: `${qty * 1000}.00`,
      }),
      user(),
    ),
  );
async function ret(customerId: number, qty: number, opts: { againstSalesId?: number; refund?: boolean } = {}) {
  const orig = opts.againstSalesId ? (await one(`select id from sales_lines where sales_id = $1`, [opts.againstSalesId])).id : null;
  return tx((t) =>
    app.saveReturn(
      t,
      app.rv.returnSaveSchema.parse({
        customerId,
        locationId: ids.locationId,
        returnDate: app.todayIST(),
        againstSalesId: opts.againstSalesId ?? null,
        gstMode: "INCLUDES",
        gstOverride: null,
        roundOff: null,
        lines: [{ productId, qty, rate: "1000.00", originalSalesLineId: orig }],
        adjustment: { manual: null, remainder: opts.refund ? "REFUND" : null, refundMode: opts.refund ? "CASH" : null },
        qtyConfirmed: true,
        remarks: "",
        expectedNet: `${qty * 1000}.00`,
      }),
      user(),
    ),
  );
}

describe("customer ledger with sales returns", () => {
  it("Sales Return Cr / Refund Dr rows, running balance, and the document each voucher opens", async () => {
    const cu = await customer();
    const older = await sale(cu, 9); // 9,000 pending
    const newer = await sale(cu, 5); // 5,000 pending
    const r1 = await ret(cu, 3, { againstSalesId: newer.id }); // newer → 2,000 pending
    await tx((t) => app.saveReceipt(t, app.v.receiptSaveSchema.parse({ customerId: cu, locationId: ids.locationId, receiptDate: app.todayIST(), payment: pay("11000"), remarks: "" }), user()));
    const r2 = await ret(cu, 2, { refund: true }); // nothing pending → refunded

    const today = app.todayIST();
    const L = await app.ledger.customerLedger(app.db, cu, today, today);
    const rows = L.entries.map((e) => [app.ledger.VOUCHER_LABEL[e.type], e.debit / 100, e.credit / 100, e.balance / 100, e.doc]);
    assert.deepEqual(rows, [
      ["Sale", 9000, 0, 9000, "sale"],
      ["Sale", 5000, 0, 14000, "sale"],
      ["Sales Return", 0, 3000, 11000, "return"],
      ["Receipt", 0, 9000, 2000, "receipt"],
      ["Receipt", 0, 2000, 0, "receipt"],
      ["Sales Return", 0, 2000, -2000, "return"],
      ["Refund", 2000, 0, 0, "return"],
    ]);
    const srRow = L.entries.find((e) => e.voucherId === r1.id && e.type === "SALES_RETURN")!;
    assert.match(srRow.particulars, new RegExp(`^Return against ${newer.billNo.replace(/\//g, "\\/")}; applied to ${newer.billNo.replace(/\//g, "\\/")} ₹3,000\\.00 — 3 pcs$`));
    assert.equal(app.ledger.voucherHref(srRow.doc, srRow.voucherId), `/print/sales-returns/${r1.id}`);
    const refund = L.entries.find((e) => e.type === "REFUND")!;
    assert.equal(app.ledger.voucherHref(refund.doc, refund.voucherId), `/print/sales-returns/${r2.id}`);
    assert.equal(L.closing, 0);
    assert.ok(older.id);
  });

  it("a Walk-in bill-cancel refund still opens the receipt; a settlement on a bill opens the bill", async () => {
    const b = await sale(walkinId, 1, "1000");
    const v = (await one(`select version from sales_header where id = $1`, [b.id])).version;
    await tx((t) => app.cancelSale(t, { id: b.id, version: v, reason: "Customer changed mind" }, user()));
    const today = app.todayIST();
    const L = await app.ledger.customerLedger(app.db, walkinId, today, today);
    const refund = L.entries.find((e) => e.type === "REFUND")!;
    assert.equal(refund.doc, "receipt");

    const cu = await customer();
    await tx((t) => app.saveReceipt(t, app.v.receiptSaveSchema.parse({ customerId: cu, locationId: ids.locationId, receiptDate: today, payment: pay("500"), remarks: "" }), user()));
    const s = await sale(cu, 1, "500"); // 500 advance adjusted → SETTLEMENT row on the bill
    const L2 = await app.ledger.customerLedger(app.db, cu, today, today);
    const settle = L2.entries.find((e) => e.type === "SETTLEMENT")!;
    assert.deepEqual([settle.doc, app.ledger.voucherHref(settle.doc, settle.voucherId)], ["sale", `/print/sales/${s.id}`]);
  });
});

describe("outstanding bills with sales returns", () => {
  it("pending is reduced by the return; received (cash/bank) and adjusted (advance / return) shown apart", async () => {
    const cu = await customer();
    const b = await sale(cu, 10, "2000"); // 2,000 received, 8,000 pending
    await ret(cu, 3, { againstSalesId: b.id }); // 3,000 adjusted → 5,000 pending
    const rows = await app.ledger.outstandingBills(app.db, { customerId: cu, asOf: app.todayIST() });
    assert.deepEqual(
      rows.map((r) => [r.ref, r.amount / 100, r.received / 100, r.adjusted / 100, r.pending / 100]),
      [[b.billNo, 10000, 2000, 3000, 5000]],
    );
    await ret(cu, 5, { againstSalesId: b.id }); // fully settled → drops off the list
    assert.equal((await app.ledger.outstandingBills(app.db, { customerId: cu, asOf: app.todayIST() })).length, 0);
  });
});
