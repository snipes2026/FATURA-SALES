/**
 * Concurrency: 10 Save Sale calls at the same moment, on a REAL PostgreSQL
 * (see helpers/real-pg.ts — PGlite can't run transactions in parallel).
 *  - no duplicate (and no skipped) bill / receipt numbers
 *  - no overselling: only as many bills as there is stock succeed
 *  - the customer's dues are never allocated twice; ledger stays consistent
 * Skipped (with a note) when no PostgreSQL is available.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { startRealPg, type RealPg } from "./helpers/real-pg";
import { runMigrations, seedBasics } from "./helpers/test-db";

let server: RealPg | null = null;
let c: pg.Client;
let ids: Awaited<ReturnType<typeof seedBasics>>;
let app: {
  db: typeof import("../src/db").db;
  pool: typeof import("../src/db").pool;
  saveSale: typeof import("../src/app/(app)/sales/_lib/save-sale").saveSale;
  v: typeof import("../src/lib/validation/sales");
  customerAccount: typeof import("../src/lib/customers").customerAccount;
  todayIST: typeof import("../src/lib/dates").todayIST;
  financialYear: typeof import("../src/lib/dates").financialYear;
};
const PARALLEL = 10;

before(async () => {
  server = await startRealPg();
  if (!server) return;
  console.log(`# concurrency test on ${server.source}`);
  await runMigrations(server.url);
  ids = await seedBasics(server.url);
  process.env.DATABASE_URL = server.url;
  process.env.DB_POOL_MAX = String(PARALLEL);
  const dbm = await import("../src/db");
  app = {
    db: dbm.db,
    pool: dbm.pool,
    saveSale: (await import("../src/app/(app)/sales/_lib/save-sale")).saveSale,
    v: await import("../src/lib/validation/sales"),
    customerAccount: (await import("../src/lib/customers")).customerAccount,
    todayIST: (await import("../src/lib/dates")).todayIST,
    financialYear: (await import("../src/lib/dates")).financialYear,
  };
  c = new pg.Client(server.url);
  await c.connect();
});

after(async () => {
  if (!server) return;
  await c.end();
  await app.pool.end();
  await server.stop();
});

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
const user = () => ({ id: ids.userId, locations: [{ id: ids.locationId, name: "Main Store", type: "STORE" as const, stateCode: "27" }] });

async function product(barcode: string, stock: number) {
  const p = await one(`insert into products (department_id, item_name, barcode, purchase_rate, wsp, mrp) values ($1,$2,$3,500,1000,1999) returning id`, [ids.deptId, `Item ${barcode}`, barcode]);
  await c.query(`insert into stock_ledger (location_id, product_id, qty_in, ref_doc_type, ref_doc_id, created_by) values ($1,$2,$3,'GRN',1,$4)`, [ids.locationId, p.id, stock, ids.userId]);
  return p.id as number;
}

function bill(customerId: number, productId: number, cash: string) {
  return app.db.transaction((tx) =>
    app.saveSale(
      tx,
      app.v.saleSaveSchema.parse({
        customerId,
        locationId: ids.locationId,
        billDate: app.todayIST(),
        gstMode: "INCLUDES",
        gstOverride: null,
        roundOff: null,
        lines: [{ productId, qty: 1, rate: "1000.00" }],
        payment: { cash, bank1: "", bank2: "", advanceUsed: null, manual: null, excess: "CHANGE" },
        expectedNet: "1000.00",
      }),
      user(),
    ),
  );
}

const seq = (nos: string[]) => nos.map((n) => Number(n.split("/").pop())).sort((a, b) => a - b);

describe("10 parallel Save Sale calls", { skip: false }, () => {
  it("same customer, same product, only 5 in stock", async (t) => {
    if (!server) return t.skip("no PostgreSQL available (set TEST_DATABASE_URL or install PostgreSQL)");
    const fy = app.financialYear(app.todayIST());
    const productId = await product("C000001", 5);
    // Customer owes 3,000 (opening). Each bill: 1,000; cash 1,500 → previous balance first.
    const cust = (await one(`insert into customers (name, phone, state_code, opening_balance, opening_type, opening_date) values ('Race Co','9','27',3000,'DR','2026-04-01') returning id`)).id;
    await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, debit) values ($1,'2026-04-01','OPENING',$1,3000)`, [cust]);

    const results = await Promise.allSettled(Array.from({ length: PARALLEL }, () => bill(cust, productId, "1500")));
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof bill>>>).value);
    const failed = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message ?? r));

    // No overselling: exactly the stock, the rest refused for stock (not deadlocks or other errors)
    assert.equal(ok.length, 5, `failures: ${failed.join(" | ")}`);
    assert.equal(failed.length, 5);
    for (const f of failed) assert.match(f, /only 0 in stock/);
    assert.equal((await one(`select sum(qty_in - qty_out)::int as q from stock_ledger where product_id = $1`, [productId])).q, 0);

    // Bill and receipt numbers: unique and gap-free (failed saves roll back their numbers)
    assert.deepEqual(seq(ok.map((r) => r.billNo)), [1, 2, 3, 4, 5]);
    assert.ok(ok.every((r) => r.billNo.startsWith(`INV/${fy}/`)));
    const rcts = (await c.query(`select receipt_no from receipts where customer_id = $1`, [cust])).rows.map((r) => r.receipt_no as string);
    assert.deepEqual(seq(rcts), [1, 2, 3, 4, 5]);
    assert.equal((await one(`select last_value from counters where name = 'INVOICE' and fy = $1`, [fy])).last_value, 5);

    // Dues never allocated twice: the 3,000 opening is received exactly once
    assert.equal((await one(`select sum(amount)::numeric(14,2) as s from receipt_allocations where target_type = 'OPENING'`)).s, "3000.00");
    const overpaid = await c.query(`
      select h.bill_no from sales_header h
      where (select coalesce(sum(amount),0) from receipt_allocations ra where ra.sales_id = h.id and ra.reversed_at is null) > h.net_amount`);
    assert.equal(overpaid.rows.length, 0);

    // Ledger: 3,000 + 5 × 1,000 − 5 × 1,500 = 500 Dr, and bill-wise view agrees
    assert.equal((await one(`select sum(debit - credit)::numeric(14,2) as b from customer_ledger where customer_id = $1`, [cust])).b, "500.00");
    const acc = await app.customerAccount(app.db, cust);
    assert.equal(acc.balancePaise, 50000);
    assert.equal(acc.dues.reduce((a, d) => a + d.pending, 0) - acc.advanceAvailable, acc.balancePaise);

    // Each bill recorded the balance it saw — they form one unbroken chain
    const chain = (await c.query(`select prev_balance, balance_after from sales_header where customer_id = $1 order by bill_no`, [cust])).rows;
    for (let i = 1; i < chain.length; i++) assert.equal(chain[i].prev_balance, chain[i - 1].balance_after);
    assert.equal(chain[0].prev_balance, "3000.00");
    assert.equal(chain.at(-1).balance_after, "500.00");
  });

  it("different customers, plenty of stock → all 10 succeed with unique numbers", async (t) => {
    if (!server) return t.skip("no PostgreSQL available");
    const productId = await product("C000002", 100);
    const custs: number[] = [];
    for (let i = 0; i < PARALLEL; i++) custs.push((await one(`insert into customers (name, phone, state_code, opening_date) values ($1,'9','27','2026-04-01') returning id`, [`P${i}`])).id);
    const before = (await one(`select count(*)::int as n from sales_header`)).n as number;
    const res = await Promise.all(custs.map((cu) => bill(cu, productId, "1000")));
    assert.deepEqual(
      seq(res.map((r) => r.billNo)),
      Array.from({ length: PARALLEL }, (_, i) => before + i + 1),
    );
    assert.equal(new Set(res.map((r) => r.receiptNo)).size, PARALLEL);
    assert.equal((await one(`select sum(qty_in - qty_out)::int as q from stock_ledger where product_id = $1`, [productId])).q, 100 - PARALLEL);
  });
});
