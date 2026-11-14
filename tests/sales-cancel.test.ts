/**
 * Cancelling bills and receipts (reversing entries, never deletes), and the
 * GRN edit/delete block once items are sold.
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
let grnId: number;
let app: {
  db: typeof import("../src/db").db;
  pool: typeof import("../src/db").pool;
  saveSale: typeof import("../src/app/(app)/sales/_lib/save-sale").saveSale;
  saveReceipt: typeof import("../src/app/(app)/receipts/_lib/save-receipt").saveReceipt;
  cancel: typeof import("../src/lib/sales/cancel");
  v: typeof import("../src/lib/validation/sales");
  customerAccount: typeof import("../src/lib/customers").customerAccount;
  grnStock: typeof import("../src/app/(app)/grn/_lib/stock");
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
    cancel: await import("../src/lib/sales/cancel"),
    v: await import("../src/lib/validation/sales"),
    customerAccount: (await import("../src/lib/customers")).customerAccount,
    grnStock: await import("../src/app/(app)/grn/_lib/stock"),
    todayIST: (await import("../src/lib/dates")).todayIST,
  };
  c = new pg.Client(t.url);
  await c.connect();
  productId = (await one(`insert into products (department_id, item_name, barcode, purchase_rate, wsp, mrp) values ($1,'Saree','T000009',600,1000,1999) returning id`, [ids.deptId])).id;
  // A saved GRN that brought the stock in
  grnId = (
    await one(
      `insert into grn_header (grn_no, fy, grn_date, status, location_id, supplier_id, invoice_no, invoice_date, invoice_value, total_qty, net_payable, created_by, saved_at)
       values ('GRN/26-27/0001','26-27','2026-04-02','SAVED',$1,$2,'S-1','2026-04-01',60000,100,60000,$3, now() - interval '1 day') returning id`,
      [ids.locationId, ids.supIntra, ids.userId],
    )
  ).id;
  await c.query(
    `insert into grn_lines (grn_id, line_no, product_id, department_id, hsn_code, item_name, qty, purchase_rate, amount, taxable_value, mrp, barcode)
     values ($1,1,$2,$3,'6205','Saree',100,600,60000,60000,1999,'T000009')`,
    [grnId, productId, ids.deptId],
  );
  await c.query(`insert into stock_ledger (location_id, product_id, qty_in, ref_doc_type, ref_doc_id, created_by) values ($1,$2,100,'GRN',$3,$4)`, [ids.locationId, productId, grnId, ids.userId]);
  walkinId = (await one(`insert into customers (name, phone, state_code, opening_date, is_walkin) values ('Walk-in Customer','0','27','2026-04-01',true) returning id`)).id;
});

after(async () => {
  await c.end();
  await app.pool.end();
  await stop();
});

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
const user = () => ({ id: ids.userId, locations: [{ id: ids.locationId, name: "Main Store", type: "STORE" as const, stateCode: "27" }] });
const pay = (cash = "", excess: "ADVANCE" | "CHANGE" | null = null, manual: Record<string, string> | null = null) => ({ cash, bank1: "", bank2: "", advanceUsed: null, manual, excess });
const tx = <T>(fn: (t: Parameters<Parameters<typeof app.db.transaction>[0]>[0]) => Promise<T>) => app.db.transaction(fn);

async function customer() {
  return (await one(`insert into customers (name, phone, state_code, opening_date) values ($1,'98','27','2026-04-01') returning id`, [`C ${Math.random()}`])).id as number;
}
async function sale(customerId: number, qty: number, p = pay()) {
  return tx((t) =>
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
        payment: p,
        expectedNet: `${qty * 1000}.00`,
      }),
      user(),
    ),
  );
}
const receipt = (customerId: number, p = pay()) =>
  tx((t) => app.saveReceipt(t, app.v.receiptSaveSchema.parse({ customerId, locationId: ids.locationId, receiptDate: app.todayIST(), payment: p, remarks: "" }), user()));
const version = async (id: number) => (await one(`select version from sales_header where id = $1`, [id])).version as number;
const cancelSale = async (id: number) => tx((t) => app.cancel.cancelSale(t, { id, version: 1, reason: "Wrong items billed" }, user()));
const balance = async (id: number) => (await one(`select coalesce(sum(debit - credit),0)::numeric(14,2) as b from customer_ledger where customer_id = $1`, [id])).b;
const stock = async () => (await one(`select sum(qty_in - qty_out)::int as q from stock_ledger where product_id = $1 and location_id = $2`, [productId, ids.locationId])).q;

describe("cancel sale", () => {
  it("part-paid credit bill: stock back, sale reversed, amount paid becomes advance", async () => {
    const cu = await customer();
    const s0 = await stock();
    const b = await sale(cu, 3, pay("1000"));
    assert.equal(await stock(), s0 - 3);
    assert.equal(await balance(cu), "2000.00");
    await cancelSale(b.id);
    assert.equal(await stock(), s0);
    assert.equal(await balance(cu), "-1000.00");
    const acc = await app.customerAccount(app.db, cu);
    assert.deepEqual([acc.dues.length, acc.advanceAvailable], [0, 100000]);
    const h = await one(`select status, cancel_reason, version from sales_header where id = $1`, [b.id]);
    assert.deepEqual(h, { status: "CANCELLED", cancel_reason: "Wrong items billed", version: 2 });
    // nothing deleted: the original Sale Dr is still there, plus the reversing entry
    const types = (await c.query(`select voucher_type from customer_ledger where customer_id = $1 order by id`, [cu])).rows.map((r) => r.voucher_type);
    assert.deepEqual(types, ["SALE", "RECEIPT", "SALE_CANCEL", "SETTLEMENT"]);
  });

  it("releases advance that was used on the bill", async () => {
    const cu = await customer();
    await receipt(cu, pay("500")); // no dues → advance 500
    const b = await sale(cu, 1, pay("500")); // 1,000 = advance 500 + cash 500
    assert.equal((await one(`select advance_used from sales_header where id = $1`, [b.id])).advance_used, "500.00");
    await cancelSale(b.id);
    const acc = await app.customerAccount(app.db, cu);
    assert.equal(acc.advanceAvailable, 100000); // 500 released + 500 paid with the bill
    assert.equal(await balance(cu), "-1000.00");
  });

  it("Walk-in: money paid is refunded (cash out), balance stays nil", async () => {
    const b = await sale(walkinId, 1, pay("1200", "CHANGE"));
    await cancelSale(b.id);
    assert.equal(await balance(walkinId), "0.00");
    const out = await one(`select mode, direction, amount from cash_bank_ledger where ref_type = 'REFUND' order by id desc limit 1`);
    assert.deepEqual(out, { mode: "CASH", direction: "OUT", amount: "1000.00" });
    assert.equal((await app.customerAccount(app.db, walkinId)).advanceAvailable, 0);
  });

  it("is blocked by a later receipt until that receipt is cancelled", async () => {
    const cu = await customer();
    const b = await sale(cu, 1); // 1,000 on credit
    const r = await receipt(cu, pay("400"));
    await assert.rejects(cancelSale(b.id), new RegExp(`${r.receiptNo.replace(/\//g, "\\/")}.*Cancel that receipt first`));
    await tx((t) => app.cancel.cancelReceipt(t, { id: r.id, reason: "Cheque bounced" }, user()));
    assert.equal(await balance(cu), "1000.00");
    const out = await one(`select direction, amount from cash_bank_ledger where ref_type = 'RECEIPT_CANCEL' and ref_id = $1`, [r.id]);
    assert.deepEqual(out, { direction: "OUT", amount: "400.00" });
    await cancelSale(b.id);
    assert.equal(await balance(cu), "0.00");
  });

  it("refuses a stale version and a second cancel", async () => {
    const cu = await customer();
    const b = await sale(cu, 1);
    await assert.rejects(tx((t) => app.cancel.cancelSale(t, { id: b.id, version: 99, reason: "x x x x x" }, user())), /changed by someone else/);
    await tx((t) => app.cancel.cancelSale(t, { id: b.id, version: 1, reason: "Duplicate bill" }, user()));
    const v2 = await version(b.id); // read outside the transaction (the test DB serves one connection at a time)
    await assert.rejects(tx((t) => app.cancel.cancelSale(t, { id: b.id, version: v2, reason: "Again please" }, user())), /already cancelled/);
  });
});

describe("cancel receipt", () => {
  it("is blocked once its advance has been used on a later bill", async () => {
    const cu = await customer();
    const r = await receipt(cu, pay("800")); // advance 800
    await sale(cu, 1); // uses the 800 advance + 200 credit
    await assert.rejects(tx((t) => app.cancel.cancelReceipt(t, { id: r.id, reason: "Entered twice" }, user())), /already been used on a later bill/);
  });
});

describe("GRN edit/delete wiring", () => {
  it("a GRN whose items are on a saved bill is locked; cancelling the bill unlocks it", async () => {
    // every earlier test cancelled its bills except the receipt-cancel one above
    const open = (await c.query(`select id from sales_header where status = 'SAVED'`)).rows.map((r) => r.id as number);
    const reason = await tx((t) => app.grnStock.grnLockReason(t, grnId));
    assert.match(reason ?? "", /Items of this GRN have been sold \(INV\//);
    assert.ok(open.length > 0);
    for (const id of open) {
      const v = await version(id);
      await tx((t) => app.cancel.cancelSale(t, { id, version: v, reason: "Free the GRN" }, user()));
    }
    assert.equal(await tx((t) => app.grnStock.grnLockReason(t, grnId)), null);
  });

  it("reversing the GRN when pieces have gone out would make stock negative → refused", async () => {
    // Sell 2 from a 3-piece GRN, then try to reverse the whole GRN
    const p2 = (await one(`insert into products (department_id, item_name, barcode, purchase_rate, wsp, mrp) values ($1,'Dupatta','T000010',100,200,399) returning id`, [ids.deptId])).id;
    await c.query(`insert into stock_ledger (location_id, product_id, qty_in, ref_doc_type, ref_doc_id, created_by) values ($1,$2,3,'GRN',999,$3)`, [ids.locationId, p2, ids.userId]);
    await c.query(`insert into stock_ledger (location_id, product_id, qty_out, ref_doc_type, ref_doc_id, created_by) values ($1,$2,2,'SALE',999,$3)`, [ids.locationId, p2, ids.userId]);
    await assert.rejects(
      tx(async (t) => {
        await t.execute(
          (await import("drizzle-orm")).sql`insert into stock_ledger (location_id, product_id, qty_out, ref_doc_type, ref_doc_id, created_by) values (${ids.locationId}, ${p2}, 3, 'GRN_CANCEL', 999, ${ids.userId})`,
        );
        await app.grnStock.assertNoNegativeStock(t, ids.locationId, [p2], "Deleting this GRN");
      }),
      /Deleting this GRN would make stock negative for T000010 \(-2\)/,
    );
    // rolled back
    assert.equal((await one(`select sum(qty_in - qty_out)::int as q from stock_ledger where product_id = $1`, [p2])).q, 1);
  });
});
