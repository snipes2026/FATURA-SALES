/**
 * Customer ledger (opening as of from-date, running balance, closing),
 * outstanding bills, and standalone receipts.
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
let custId: number;
let app: {
  db: typeof import("../src/db").db;
  pool: typeof import("../src/db").pool;
  saveSale: typeof import("../src/app/(app)/sales/_lib/save-sale").saveSale;
  saveReceipt: typeof import("../src/app/(app)/receipts/_lib/save-receipt").saveReceipt;
  v: typeof import("../src/lib/validation/sales");
  ledger: typeof import("../src/lib/sales/ledger");
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
    v: await import("../src/lib/validation/sales"),
    ledger: await import("../src/lib/sales/ledger"),
  };
  c = new pg.Client(t.url);
  await c.connect();
  productId = (
    await c.query(`insert into products (department_id, item_name, barcode, purchase_rate, wsp, mrp) values ($1,'Kurta','T000002',500,1000,1999) returning id`, [ids.deptId])
  ).rows[0].id;
  await c.query(`insert into stock_ledger (location_id, product_id, qty_in, ref_doc_type, ref_doc_id, created_by) values ($1,$2,1000,'GRN',1,$3)`, [ids.locationId, productId, ids.userId]);
  custId = (
    await c.query(`insert into customers (name, phone, state_code, opening_balance, opening_type, opening_date) values ('Ledger Co','98','27',5000,'DR','2026-04-01') returning id`)
  ).rows[0].id;
  await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, voucher_no, debit) values ($1,'2026-04-01','OPENING',$1,'OPENING',5000)`, [custId]);
});

after(async () => {
  await c.end();
  await app.pool.end();
  await stop();
});

const user = () => ({ id: ids.userId, locations: [{ id: ids.locationId, name: "Main Store", type: "STORE" as const, stateCode: "27" }] });
const pay = (p: Partial<{ cash: string; bank1: string; manual: Record<string, string> | null; excess: "ADVANCE" | "CHANGE" | null }> = {}) => ({
  cash: p.cash ?? "",
  bank1: p.bank1 ?? "",
  bank2: "",
  advanceUsed: null,
  manual: p.manual ?? null,
  excess: p.excess ?? null,
});
const sale = (date: string, qty: number, p: ReturnType<typeof pay>) =>
  app.db.transaction((tx) =>
    app.saveSale(
      tx,
      app.v.saleSaveSchema.parse({
        customerId: custId,
        locationId: ids.locationId,
        billDate: date,
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
const receipt = (date: string, p: ReturnType<typeof pay>) =>
  app.db.transaction((tx) =>
    app.saveReceipt(tx, app.v.receiptSaveSchema.parse({ customerId: custId, locationId: ids.locationId, receiptDate: date, payment: p, remarks: "" }), user()),
  );
const R = (p: number) => p / 100;

describe("customer ledger", () => {
  let billA: number;
  let billB: number;
  let pendingBill: number;

  it("posts opening + bills + receipts + advance", async () => {
    billA = (await sale("2026-05-10", 3, pay({ cash: "2000" }))).id; // 3,000: 2,000 → opening (5,000 → 3,000 left), credit 3,000
    billB = (await sale("2026-06-15", 2, pay())).id; // 2,000 on credit
    await receipt("2026-07-01", pay({ bank1: "4000" })); // opening 3,000 + 1,000 of bill A
    await receipt("2026-08-01", pay({ cash: "5500", excess: "ADVANCE" })); // A 2,000 + B 2,000 + advance 1,500
    const bal = await c.query(`select sum(debit - credit)::numeric(14,2) as b from customer_ledger where customer_id = $1`, [custId]);
    assert.equal(bal.rows[0].b, "-1500.00");
  });

  it("opening balance as of the from-date, running balance and closing", async () => {
    const l = await app.ledger.customerLedger(app.db, custId, "2026-06-01", "2026-07-31");
    assert.equal(R(l.opening), 6000); // 5,000 + 3,000 − 2,000 before 1 June
    assert.deepEqual(
      l.entries.map((e) => [e.date, e.type, R(e.debit), R(e.credit), R(e.balance)]),
      [
        ["2026-06-15", "SALE", 2000, 0, 8000],
        ["2026-07-01", "RECEIPT", 0, 3000, 5000], // against opening
        ["2026-07-01", "RECEIPT", 0, 1000, 4000], // against bill A
      ],
    );
    assert.equal(R(l.closing), 4000);
    assert.equal(R(l.totalDebit), 2000);
    assert.equal(R(l.totalCredit), 4000);
  });

  it("full range ends with the advance; a range with no entries keeps the balance", async () => {
    const all = await app.ledger.customerLedger(app.db, custId, "2026-04-01", "2026-12-31");
    assert.equal(R(all.opening), 0);
    assert.equal(all.entries[0].type, "OPENING");
    assert.equal(R(all.closing), -1500);
    assert.equal(all.entries.at(-1)!.type, "ADVANCE");
    const empty = await app.ledger.customerLedger(app.db, custId, "2026-09-01", "2026-09-30");
    assert.equal(empty.entries.length, 0);
    assert.equal(R(empty.opening), -1500);
    assert.equal(R(empty.closing), -1500);
  });

  it("outstanding bills: opening and both bills fully received", async () => {
    assert.equal((await app.ledger.outstandingBills(app.db, { customerId: custId, asOf: "2026-12-31" })).length, 0);
    const recv = await c.query(
      `select sales_id, sum(amount)::numeric(14,2) as s from receipt_allocations where target_type = 'BILL' and sales_id in ($1,$2) group by sales_id order by sales_id`,
      [billA, billB],
    );
    assert.deepEqual(recv.rows, [
      { sales_id: billA, s: "3000.00" },
      { sales_id: billB, s: "2000.00" },
    ]);
  });

  it("receipt: edited split, and advance refused while a bill stays pending", async () => {
    const b1 = (await sale("2026-10-01", 1, pay())).id; // 1,000 — but the 1,500 advance is used first
    const h = await c.query(`select advance_used, credit_amount from sales_header where id = $1`, [b1]);
    assert.deepEqual(h.rows[0], { advance_used: "1000.00", credit_amount: "0.00" });
    const b2 = (await sale("2026-10-02", 2, pay())).id; // 2,000: 500 advance left → credit 1,500
    const b3 = (await sale("2026-10-03", 1, pay())).id; // 1,000 credit
    const out = await app.ledger.outstandingBills(app.db, { customerId: custId, asOf: "2026-10-13" });
    assert.deepEqual(
      out.map((o) => [o.salesId, R(o.amount), R(o.received), R(o.pending), o.ageDays]),
      [
        [b2, 2000, 500, 1500, 11],
        [b3, 1000, 0, 1000, 10],
      ],
    );
    // Pay the newer bill only, leave the older one pending
    const r = await receipt("2026-10-05", pay({ cash: "1000", manual: { [`BILL:${b3}`]: "1000" } }));
    assert.equal(r.total, 100000);
    const left = await app.ledger.outstandingBills(app.db, { customerId: custId, asOf: "2026-10-13" });
    assert.deepEqual(
      left.map((o) => [o.salesId, R(o.pending)]),
      [[b2, 1500]],
    );
    // Extra kept as advance while b2 is still pending → refused
    await assert.rejects(receipt("2026-10-06", pay({ cash: "200", manual: {}, excess: "ADVANCE" })), /previous balance/);
    pendingBill = b2;
  });

  it("cancelling a sale shows as reversing entries with the right running and closing balance", async () => {
    const before = await app.ledger.customerLedger(app.db, custId, "2026-04-01", "2026-12-31");
    assert.equal(R(before.closing), 1500); // = b2 still pending
    const { cancelSale } = await import("../src/lib/sales/cancel");
    await app.db.transaction((tx) => cancelSale(tx, { id: pendingBill, version: 1, reason: "Customer returned all" }, user()));

    const l = await app.ledger.customerLedger(app.db, custId, "2026-04-01", "2026-12-31");
    const tail = l.entries.slice(-2).map((e) => [e.type, R(e.debit), R(e.credit), R(e.balance)]);
    assert.deepEqual(tail, [
      ["SALE_CANCEL", 0, 2000, -500], // the 2,000 bill reversed
      ["SETTLEMENT", 0, 0, -500], // its 500 advance released (no money moves)
    ]);
    assert.equal(R(l.closing), -500);
    // Nothing deleted: the original sale is still in the ledger
    assert.ok(l.entries.some((e) => e.type === "SALE" && e.voucherId === pendingBill));
    // Bill-wise: nothing pending, the 500 advance is back
    assert.equal((await app.ledger.outstandingBills(app.db, { customerId: custId, asOf: "2026-12-31" })).length, 0);
    const { customerAccount } = await import("../src/lib/customers");
    const acc = await customerAccount(app.db, custId);
    assert.deepEqual([acc.dues.length, acc.advanceAvailable, acc.balancePaise], [0, 50000, -50000]);
    // A range that ends before the cancel still shows the bill as it was
    const earlier = await app.ledger.customerLedger(app.db, custId, "2026-10-01", "2026-10-31");
    assert.equal(R(earlier.closing), 1500);
  });
});
