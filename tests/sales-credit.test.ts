/**
 * Sales + the credit pool (Phase 3, Section 6): advance / return credit adjusted
 * on a new bill, the never-Dr-and-Cr invariant after cancels, credit restored on
 * a bill cancel, and a linked Sales Return blocking the bill's cancel.
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
let app: {
  db: typeof import("../src/db").db;
  pool: typeof import("../src/db").pool;
  saveSale: typeof import("../src/app/(app)/sales/_lib/save-sale").saveSale;
  saveReceipt: typeof import("../src/app/(app)/receipts/_lib/save-receipt").saveReceipt;
  cancel: typeof import("../src/lib/sales/cancel");
  v: typeof import("../src/lib/validation/sales");
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
    saveReceipt: (await import("../src/app/(app)/receipts/_lib/save-receipt")).saveReceipt,
    cancel: await import("../src/lib/sales/cancel"),
    v: await import("../src/lib/validation/sales"),
    customerAccount: (await import("../src/lib/customers")).customerAccount,
    todayIST: (await import("../src/lib/dates")).todayIST,
  };
  c = new pg.Client(t.url);
  await c.connect();
  productId = (await one(`insert into products (department_id, item_name, barcode, purchase_rate, wsp, mrp) values ($1,'Kurta','T000001',500,1000,1999) returning id`, [ids.deptId])).id;
  await c.query(`insert into stock_ledger (location_id, product_id, qty_in, ref_doc_type, ref_doc_id, created_by) values ($1,$2,500,'GRN',1,$3)`, [ids.locationId, productId, ids.userId]);
});

after(async () => {
  await c.end();
  await app.pool.end();
  await stop();
});

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
const user = () => ({ id: ids.userId, locations: [{ id: ids.locationId, name: "Main Store", type: "STORE" as const, stateCode: "27" }] });
type Pay = { cash?: string; advanceUsed?: string | null };
const pay = (p: Pay = {}) => ({ cash: p.cash ?? "", bank1: "", bank2: "", advanceUsed: p.advanceUsed ?? null, manual: null, excess: null });
const tx = <T>(fn: (t: Parameters<Parameters<typeof app.db.transaction>[0]>[0]) => Promise<T>) => app.db.transaction(fn);

async function customer() {
  return (await one(`insert into customers (name, phone, state_code, opening_date) values ($1,'98','27','2026-04-01') returning id`, [`C ${Math.random()}`])).id as number;
}
/** qty × ₹1,000 (Includes GST) */
const sale = (customerId: number, qty: number, p: Pay = {}) =>
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
        payment: pay(p),
        expectedNet: `${qty * 1000}.00`,
      }),
      user(),
    ),
  );
const receipt = (customerId: number, cash: string) =>
  tx((t) => app.saveReceipt(t, app.v.receiptSaveSchema.parse({ customerId, locationId: ids.locationId, receiptDate: app.todayIST(), payment: pay({ cash }), remarks: "" }), user()));
const version = async (id: number) => (await one(`select version from sales_header where id = $1`, [id])).version as number;
const cancelSale = async (id: number) => {
  const v = await version(id);
  return tx((t) => app.cancel.cancelSale(t, { id, version: v, reason: "Billed by mistake" }, user()));
};

/** Balance, pending dues and advance — and the invariant: never both Dr (dues) and Cr (advance). */
async function position(id: number) {
  const a = await app.customerAccount(app.db, id);
  const dues = a.dues.reduce((s, d) => s + d.pending, 0);
  assert.equal(dues - a.advanceAvailable, a.balancePaise, "Σ dues − advance = ledger balance");
  assert.ok(!(dues > 0 && a.advanceAvailable > 0), `never both Dr and Cr (dues ${dues}, advance ${a.advanceAvailable})`);
  return { balance: a.balancePaise / 100, dues: dues / 100, advance: a.advanceAvailable / 100, fromReturns: a.advanceFromReturns / 100 };
}

/** A sales-return credit, as Step 5 will post it: SALES_RETURN Cr in the ledger + a pool row. */
async function returnCredit(customerId: number, amount: number, againstSalesId: number | null = null) {
  const h = await one(
    `insert into sales_return_header (return_no, fy, return_date, customer_id, location_id, against_sales_id, customer_name, customer_state_code, gst_mode, tax_type,
       total_qty, gross, taxable, gst_amount, net_amount, advance_created, created_by)
     values ($1,'26-27',$2,$3,$4,$5,'X','27','INCLUDES','INTRA',1,$6,$6,0,$6,$6,$7) returning id`,
    [`SR/T/${Math.random()}`, app.todayIST(), customerId, ids.locationId, againstSalesId, amount, ids.userId],
  );
  await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, credit) values ($1,$2,'SALES_RETURN',$3,$4)`, [customerId, app.todayIST(), h.id, amount]);
  await c.query(`insert into customer_credits (customer_id, source_type, source_id, credit_date, amount, remaining) values ($1,'SALES_RETURN',$2,$3,$4,$4)`, [
    customerId,
    h.id,
    app.todayIST(),
    amount,
  ]);
  return h.id as number;
}

describe("advance / credit on a new bill", () => {
  it("Section 6 example: advance 5,000, bill 12,000, cash 7,000 → no credit, balance Nil", async () => {
    const cu = await customer();
    await receipt(cu, "5000"); // no dues → advance
    assert.deepEqual(await position(cu), { balance: -5000, dues: 0, advance: 5000, fromReturns: 0 });
    const b = await sale(cu, 12, { cash: "7000" });
    const h = await one(`select advance_used, credit_amount, balance_after from sales_header where id = $1`, [b.id]);
    assert.deepEqual(h, { advance_used: "5000.00", credit_amount: "0.00", balance_after: "0.00" });
    assert.deepEqual(await position(cu), { balance: 0, dues: 0, advance: 0, fromReturns: 0 });
    const applied = (await c.query(`select target_type, amount from credit_applications where sales_id = $1 and reversed_at is null`, [b.id])).rows;
    assert.deepEqual(applied, [{ target_type: "BILL", amount: "5000.00" }]);
  });

  it("Adjust off with the bill going on credit is refused by the server", async () => {
    const cu = await customer();
    await receipt(cu, "500");
    await assert.rejects(sale(cu, 2, { cash: "1000", advanceUsed: "0" }), /adjust it against this bill/);
    // fully paid with Adjust off is fine — the advance stays
    await sale(cu, 1, { cash: "1000", advanceUsed: "0" });
    assert.deepEqual(await position(cu), { balance: -500, dues: 0, advance: 500, fromReturns: 0 });
  });

  it("return credit pays a bill like an advance, and shows as 'of which return credit'", async () => {
    const cu = await customer();
    await returnCredit(cu, 300);
    assert.deepEqual(await position(cu), { balance: -300, dues: 0, advance: 300, fromReturns: 300 });
    const b = await sale(cu, 1, { cash: "700" });
    assert.deepEqual(await position(cu), { balance: 0, dues: 0, advance: 0, fromReturns: 0 });
    // cancelling the bill restores the return credit, and the 700 paid becomes an advance
    await cancelSale(b.id);
    assert.deepEqual(await position(cu), { balance: -1000, dues: 0, advance: 1000, fromReturns: 300 });
  });
});

describe("never Dr and Cr after a cancel", () => {
  it("cancelled bill: money paid on it clears the customer's other pending bills first", async () => {
    const cu = await customer();
    const paid = await sale(cu, 1, { cash: "1000" }); // paid in full with its own receipt
    await sale(cu, 3); // 3,000 on credit
    assert.deepEqual(await position(cu), { balance: 3000, dues: 3000, advance: 0, fromReturns: 0 });
    // Cancel the paid bill: its 1,000 would be an advance, but 3,000 is pending → applied there
    const r = await cancelSale(paid.id);
    assert.equal(r.settledElsewhere, 100000);
    assert.deepEqual(await position(cu), { balance: 2000, dues: 2000, advance: 0, fromReturns: 0 });
    const settle = await one(`select particulars from customer_ledger where customer_id = $1 and voucher_type = 'SETTLEMENT' order by id desc limit 1`, [cu]);
    assert.match(settle.particulars, /Advance ₹1,000\.00 adjusted against INV\/.* — INV\/.* cancelled/);
  });

  it("cancelled receipt: the bill it paid is pending again and takes the customer's advance", async () => {
    const cu = await customer();
    await sale(cu, 1); // 1,000 on credit
    const r1 = await receipt(cu, "1000"); // clears it
    await receipt(cu, "500"); // nothing pending → 500 advance
    assert.deepEqual(await position(cu), { balance: -500, dues: 0, advance: 500, fromReturns: 0 });
    await tx((t) => app.cancel.cancelReceipt(t, { id: r1.id, reason: "Cheque bounced" }, user()));
    assert.deepEqual(await position(cu), { balance: 500, dues: 500, advance: 0, fromReturns: 0 });
  });
});

describe("linked Sales Return", () => {
  it("a bill with an active return against it can't be cancelled until the return is", async () => {
    const cu = await customer();
    const b = await sale(cu, 2, { cash: "2000" });
    const sr = await returnCredit(cu, 1000, b.id);
    await assert.rejects(cancelSale(b.id), /Sales Return SR\/T\/.* was made against INV\/.*Cancel that return first/);
    await c.query(`update sales_return_header set status = 'CANCELLED', cancel_reason = 'test' where id = $1`, [sr]);
    await cancelSale(b.id);
  });
});
