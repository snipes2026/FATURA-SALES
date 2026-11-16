/**
 * Cancelling a Sales Return (credit note): reversing entries only — the bill's
 * pending amount and the stock come back, the credit / refund are reversed —
 * and the cases where the cancel is refused.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { runMigrations, seedBasics, startTestDb } from "./helpers/test-db";

let stop: () => Promise<void>;
let c: pg.Client;
let ids: Awaited<ReturnType<typeof seedBasics>>;
let app: {
  db: typeof import("../src/db").db;
  pool: typeof import("../src/db").pool;
  saveSale: typeof import("../src/app/(app)/sales/_lib/save-sale").saveSale;
  saveReturn: typeof import("../src/app/(app)/sales-returns/_lib/save-return").saveReturn;
  cancelReturn: typeof import("../src/lib/sales/return-cancel").cancelReturn;
  cancelSale: typeof import("../src/lib/sales/cancel").cancelSale;
  v: typeof import("../src/lib/validation/sales");
  rv: typeof import("../src/lib/validation/sales-return");
  customerAccount: typeof import("../src/lib/customers").customerAccount;
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
    saveReturn: (await import("../src/app/(app)/sales-returns/_lib/save-return")).saveReturn,
    cancelReturn: (await import("../src/lib/sales/return-cancel")).cancelReturn,
    cancelSale: (await import("../src/lib/sales/cancel")).cancelSale,
    v: await import("../src/lib/validation/sales"),
    rv: await import("../src/lib/validation/sales-return"),
    customerAccount: (await import("../src/lib/customers")).customerAccount,
    todayIST: (await import("../src/lib/dates")).todayIST,
  };
  c = new pg.Client(t.url);
  await c.connect();
});

after(async () => {
  await c.end();
  await app.pool.end();
  await stop();
});

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
const user = () => ({ id: ids.userId, locations: [{ id: ids.locationId, name: "Main Store", type: "STORE" as const, stateCode: "27" }] });
const tx = <T>(fn: (t: Parameters<Parameters<typeof app.db.transaction>[0]>[0]) => Promise<T>) => app.db.transaction(fn);
let seq = 0;

async function product(stock: number) {
  const p = (await one(`insert into products (department_id, item_name, barcode, purchase_rate, wsp, mrp) values ($1,'Item',$2,500,1000,1999) returning id`, [ids.deptId, `X${++seq}`])).id as number;
  if (stock) await c.query(`insert into stock_ledger (location_id, product_id, qty_in, ref_doc_type, ref_doc_id, created_by) values ($1,$2,$3,'GRN',1,$4)`, [ids.locationId, p, stock, ids.userId]);
  return p;
}
const customer = async () => (await one(`insert into customers (name, phone, state_code, opening_date) values ($1,'98','27','2026-04-01') returning id`, [`C ${Math.random()}`])).id as number;

const sale = (customerId: number, productId: number, qty: number, cash = "") =>
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
        payment: { cash, bank1: "", bank2: "", advanceUsed: null, manual: null, excess: null },
        expectedNet: `${qty * 1000}.00`,
      }),
      user(),
    ),
  );

async function ret(customerId: number, productId: number, qty: number, opts: { againstSalesId?: number; refund?: boolean } = {}) {
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
const version = async (table: string, id: number) => (await one(`select version from ${table} where id = $1`, [id])).version as number;
const cancelRet = async (id: number) => {
  const v = await version("sales_return_header", id);
  return tx((t) => app.cancelReturn(t, { id, version: v, reason: "Goods were not returned" }, user()));
};
const cancelBill = async (id: number) => {
  const v = await version("sales_header", id);
  return tx((t) => app.cancelSale(t, { id, version: v, reason: "Billed by mistake" }, user()));
};
async function position(id: number) {
  const a = await app.customerAccount(app.db, id);
  const dues = a.dues.reduce((s, d) => s + d.pending, 0);
  assert.equal(dues - a.advanceAvailable, a.balancePaise);
  assert.ok(!(dues > 0 && a.advanceAvailable > 0), "never both Dr and Cr");
  return { balance: a.balancePaise / 100, dues: dues / 100, advance: a.advanceAvailable / 100 };
}
const stock = async (productId: number) => (await one(`select coalesce(sum(qty_in - qty_out),0)::int as q from stock_ledger where product_id = $1`, [productId])).q as number;

describe("cancel sales return", () => {
  it("restores the bill's pending amount and the stock; reversing entries only", async () => {
    const p = await product(50);
    const cu = await customer();
    const b = await sale(cu, p, 10); // 10,000 pending
    const r = await ret(cu, p, 4, { againstSalesId: b.id });
    assert.deepEqual(await position(cu), { balance: 6000, dues: 6000, advance: 0 });
    assert.equal(await stock(p), 44);

    // the bill can't be cancelled while the linked return is active
    await assert.rejects(cancelBill(b.id), /Cancel that return first/);

    await cancelRet(r.id);
    assert.deepEqual(await position(cu), { balance: 10000, dues: 10000, advance: 0 });
    assert.equal(await stock(p), 40);
    const h = await one(`select status, cancel_reason, version from sales_return_header where id = $1`, [r.id]);
    assert.deepEqual(h, { status: "CANCELLED", cancel_reason: "Goods were not returned", version: 2 });
    const types = (await c.query(`select voucher_type, debit, credit from customer_ledger where customer_id = $1 order by id`, [cu])).rows;
    assert.deepEqual(types, [
      { voucher_type: "SALE", debit: "10000.00", credit: "0.00" },
      { voucher_type: "SALES_RETURN", debit: "0.00", credit: "4000.00" },
      { voucher_type: "SALES_RETURN_CANCEL", debit: "4000.00", credit: "0.00" },
    ]);
    const cr = await one(`select remaining, reversed_at is not null as rev from customer_credits where source_type = 'SALES_RETURN' and source_id = $1`, [r.id]);
    assert.deepEqual(cr, { remaining: "0.00", rev: true });
    // and now the bill itself can be cancelled
    await cancelBill(b.id);
  });

  it("refund return: the refund is reversed (cash back IN), balance where it was", async () => {
    const p = await product(10);
    const cu = await customer();
    await sale(cu, p, 2, "2000");
    const r = await ret(cu, p, 2, { refund: true });
    assert.deepEqual(await position(cu), { balance: 0, dues: 0, advance: 0 });
    await cancelRet(r.id);
    assert.deepEqual(await position(cu), { balance: 0, dues: 0, advance: 0 });
    const cash = (await c.query(`select ref_type, direction, amount from cash_bank_ledger where ref_id = $1 and ref_type like 'SALES_RETURN%' order by id`, [r.id])).rows;
    assert.deepEqual(cash, [
      { ref_type: "SALES_RETURN", direction: "OUT", amount: "2000.00" },
      { ref_type: "SALES_RETURN_CANCEL", direction: "IN", amount: "2000.00" },
    ]);
    assert.equal((await one(`select credit from customer_ledger where voucher_type = 'REFUND_CANCEL' and voucher_id = $1`, [r.id])).credit, "2000.00");
  });

  it("is refused when the returned pieces have since been sold (stock would go negative)", async () => {
    const p = await product(1);
    const cu = await customer();
    await sale(cu, p, 1, "1000"); // stock 0
    const r = await ret(cu, p, 1); // stock 1, 1,000 advance
    await sale(await customer(), p, 1, "1000"); // the returned piece is sold again → stock 0
    await assert.rejects(cancelRet(r.id), /Cancelling SR\/.* would make stock negative for X\d+ \(-1\)/);
    assert.equal(await stock(p), 0); // rolled back
    assert.equal((await one(`select status from sales_return_header where id = $1`, [r.id])).status, "SAVED");
  });

  it("is refused while the advance it left has been used on a later bill; allowed once that bill is cancelled", async () => {
    const p = await product(20);
    const cu = await customer();
    await sale(cu, p, 3, "3000");
    const r = await ret(cu, p, 3); // 3,000 advance (return credit)
    const later = await sale(cu, p, 2); // uses 2,000 of it
    await assert.rejects(cancelRet(r.id), /₹2,000\.00 of the credit from SR\/.* has since been used on INV\/.*Cancel that bill first/);
    await cancelBill(later.id);
    await cancelRet(r.id);
    assert.deepEqual(await position(cu), { balance: 0, dues: 0, advance: 0 });
  });

  it("cancelling a return makes its bills pending again — the customer's other credit then pays them", async () => {
    const p = await product(20);
    const cu = await customer();
    const b = await sale(cu, p, 5); // 5,000 pending
    const r = await ret(cu, p, 2, { againstSalesId: b.id }); // 3,000 pending
    // a receipt can't create an advance while 3,000 is pending, so simulate credit arriving the way an
    // opening Cr does: a second return, free-form, larger than what is pending → 3,000 to the bill, 1,000 advance
    await ret(cu, p, 4);
    assert.deepEqual(await position(cu), { balance: -1000, dues: 0, advance: 1000 });
    await cancelRet(r.id); // INV pending 2,000 again → the 1,000 advance goes to it
    assert.deepEqual(await position(cu), { balance: 1000, dues: 1000, advance: 0 });
  });

  it("refuses a stale version and a second cancel", async () => {
    const p = await product(5);
    const cu = await customer();
    await sale(cu, p, 1, "1000");
    const r = await ret(cu, p, 1);
    await assert.rejects(tx((t) => app.cancelReturn(t, { id: r.id, version: 99, reason: "x x x x x" }, user())), /changed by someone else/);
    await cancelRet(r.id);
    await assert.rejects(cancelRet(r.id), /already cancelled/);
  });
});
