/**
 * Concurrency: sales and sales returns saved at the same moment for ONE
 * customer, on a REAL PostgreSQL (see helpers/real-pg.ts — PGlite can't run
 * transactions in parallel).
 *  - the ledger stays consistent (balance = Σ dues − credit) and the customer is
 *    never both in Debit and in Credit
 *  - credit is never applied twice (no credit used beyond its amount, no bill paid beyond its net)
 *  - bill and credit note numbers are unique and gap-free
 *  - a return cancel racing a sale that wants its advance: exactly one consistent outcome
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
let productId: number;
let app: {
  db: typeof import("../src/db").db;
  pool: typeof import("../src/db").pool;
  saveSale: typeof import("../src/app/(app)/sales/_lib/save-sale").saveSale;
  saveReturn: typeof import("../src/app/(app)/sales-returns/_lib/save-return").saveReturn;
  cancelReturn: typeof import("../src/lib/sales/return-cancel").cancelReturn;
  v: typeof import("../src/lib/validation/sales");
  rv: typeof import("../src/lib/validation/sales-return");
  customerAccount: typeof import("../src/lib/customers").customerAccount;
  todayIST: typeof import("../src/lib/dates").todayIST;
};
const PAIRS = 6;

before(async () => {
  server = await startRealPg();
  if (!server) return;
  console.log(`# return concurrency test on ${server.source}`);
  await runMigrations(server.url);
  ids = await seedBasics(server.url);
  process.env.DATABASE_URL = server.url;
  process.env.DB_POOL_MAX = String(PAIRS * 2);
  const dbm = await import("../src/db");
  app = {
    db: dbm.db,
    pool: dbm.pool,
    saveSale: (await import("../src/app/(app)/sales/_lib/save-sale")).saveSale,
    saveReturn: (await import("../src/app/(app)/sales-returns/_lib/save-return")).saveReturn,
    cancelReturn: (await import("../src/lib/sales/return-cancel")).cancelReturn,
    v: await import("../src/lib/validation/sales"),
    rv: await import("../src/lib/validation/sales-return"),
    customerAccount: (await import("../src/lib/customers")).customerAccount,
    todayIST: (await import("../src/lib/dates")).todayIST,
  };
  c = new pg.Client(server.url);
  await c.connect();
  productId = (await one(`insert into products (department_id, item_name, barcode, purchase_rate, wsp, mrp) values ($1,'Kurta','R000001',500,1000,1999) returning id`, [ids.deptId])).id;
  await c.query(`insert into stock_ledger (location_id, product_id, qty_in, ref_doc_type, ref_doc_id, created_by) values ($1,$2,1000,'GRN',1,$3)`, [ids.locationId, productId, ids.userId]);
});

after(async () => {
  if (!server) return;
  await c.end();
  await app.pool.end();
  await server.stop();
});

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
const user = () => ({ id: ids.userId, locations: [{ id: ids.locationId, name: "Main Store", type: "STORE" as const, stateCode: "27" }] });
const customer = async (name: string) => (await one(`insert into customers (name, phone, state_code, opening_date) values ($1,'9','27','2026-04-01') returning id`, [name])).id as number;
const seq = (nos: string[]) => nos.map((n) => Number(n.split("/").pop())).sort((a, b) => a - b);

/** qty × ₹1,000 on credit (or paid with `cash`). */
const sale = (customerId: number, qty: number, cash = "") =>
  app.db.transaction((tx) =>
    app.saveSale(
      tx,
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

/** Free-form return of qty × ₹1,000, default settlement (dues first, rest as advance). */
const ret = (customerId: number, qty: number) =>
  app.db.transaction((tx) =>
    app.saveReturn(
      tx,
      app.rv.returnSaveSchema.parse({
        customerId,
        locationId: ids.locationId,
        returnDate: app.todayIST(),
        againstSalesId: null,
        gstMode: "INCLUDES",
        gstOverride: null,
        roundOff: null,
        lines: [{ productId, qty, rate: "1000.00", originalSalesLineId: null }],
        adjustment: { manual: null, remainder: null, refundMode: null },
        qtyConfirmed: true,
        remarks: "",
        expectedNet: `${qty * 1000}.00`,
      }),
      user(),
    ),
  );

/** Every consistency rule the pool and the ledger must satisfy for one customer. */
async function assertConsistent(customerId: number) {
  const a = await app.customerAccount(app.db, customerId);
  const dues = a.dues.reduce((s, d) => s + d.pending, 0);
  assert.equal(dues - a.advanceAvailable, a.balancePaise, "Σ dues − credit = ledger balance");
  assert.ok(!(dues > 0 && a.advanceAvailable > 0), `never both Dr and Cr (dues ${dues}, credit ${a.advanceAvailable})`);

  // No credit used beyond its amount: amount = remaining + live applications, for every credit
  const credits = await c.query(
    `select cc.id, cc.amount, cc.remaining, cc.reversed_at is not null as rev,
       coalesce((select sum(ca.amount) from credit_applications ca where ca.credit_id = cc.id and ca.reversed_at is null), 0)::numeric(14,2) as used
     from customer_credits cc where cc.customer_id = $1`,
    [customerId],
  );
  for (const r of credits.rows) {
    if (r.rev) assert.equal(r.used, "0.00", `withdrawn credit ${r.id} has no live applications`);
    else assert.equal((Number(r.remaining) + Number(r.used)).toFixed(2), Number(r.amount).toFixed(2), `credit ${r.id}: remaining + used = amount`);
    assert.ok(Number(r.remaining) >= 0);
  }

  // No bill paid beyond its net (receipts + credit applied)
  const over = await c.query(
    `select h.bill_no from sales_header h where h.customer_id = $1 and
       (select coalesce(sum(amount),0) from receipt_allocations where sales_id = h.id and reversed_at is null)
       + (select coalesce(sum(amount),0) from credit_applications where sales_id = h.id and reversed_at is null) > h.net_amount`,
    [customerId],
  );
  assert.deepEqual(over.rows, [], "no bill overpaid");
  return { balance: a.balancePaise / 100, dues: dues / 100, credit: a.advanceAvailable / 100 };
}

describe("sales and returns at the same moment, one customer", { skip: false }, () => {
  it(`${PAIRS} sales (2,000 on credit) and ${PAIRS} returns (1,000) in parallel → one consistent ledger`, async (t) => {
    if (!server) return t.skip("no PostgreSQL available (set TEST_DATABASE_URL or install PostgreSQL)");
    const cu = await customer("Race Traders");
    const jobs = Array.from({ length: PAIRS }, () => [sale(cu, 2), ret(cu, 1)]).flat();
    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message ?? r));
    assert.deepEqual(failed, [], "no deadlocks or errors");

    // 6 × 2,000 sold − 6 × 1,000 returned = 6,000 Dr, whatever the order was
    assert.deepEqual(await assertConsistent(cu), { balance: 6000, dues: 6000, credit: 0 });

    // Every return credit was used exactly once — on bills (none left over, since dues remain)
    const pool = await one(`select sum(amount)::numeric(14,2) as amount, sum(remaining)::numeric(14,2) as remaining from customer_credits where customer_id = $1 and source_type = 'SALES_RETURN'`, [cu]);
    assert.deepEqual(pool, { amount: "6000.00", remaining: "0.00" });

    // Numbers unique and gap-free
    const bills = (await c.query(`select bill_no from sales_header where customer_id = $1`, [cu])).rows.map((r) => r.bill_no as string);
    const notes = (await c.query(`select return_no from sales_return_header where customer_id = $1`, [cu])).rows.map((r) => r.return_no as string);
    assert.deepEqual(seq(bills), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(seq(notes), [1, 2, 3, 4, 5, 6]);

    // Each document recorded the balance it saw — one unbroken chain across both kinds, in the order
    // they actually ran (the audit row is written while the customer lock is held; created_at is the
    // transaction's start time, before it waited for the lock)
    const chain = (
      await c.query(
        `select x.prev_balance, x.balance_after from (
           select 'sales_header' as t, id, prev_balance, balance_after from sales_header where customer_id = $1
           union all select 'sales_return_header', id, prev_balance, balance_after from sales_return_header where customer_id = $1
         ) x join audit_log a on a.table_name = x.t and a.record_id = x.id::text and a.action = 'CREATE'
         order by a.id`,
        [cu],
      )
    ).rows;
    assert.equal(chain.length, PAIRS * 2);
    assert.equal(chain[0].prev_balance, "0.00");
    for (let i = 1; i < chain.length; i++) assert.equal(chain[i].prev_balance, chain[i - 1].balance_after, `chain breaks at ${i}`);
    assert.equal(chain.at(-1).balance_after, "6000.00");
  });

  it("returns first build credit; parallel sales never use the same credit twice", async (t) => {
    if (!server) return t.skip("no PostgreSQL available");
    const cu = await customer("Credit Race");
    await sale(cu, 3, "3000"); // bought and paid 3
    await ret(cu, 3); // 3,000 return credit, nothing pending
    assert.deepEqual(await assertConsistent(cu), { balance: -3000, dues: 0, credit: 3000 });

    // 8 bills of 1,000 at once, nothing paid: 3 are covered by the credit, 5 go on credit
    const res = await Promise.allSettled(Array.from({ length: 8 }, () => sale(cu, 1)));
    assert.equal(res.filter((r) => r.status === "rejected").length, 0);
    assert.deepEqual(await assertConsistent(cu), { balance: 5000, dues: 5000, credit: 0 });
    const used = await one(
      `select count(distinct ca.sales_id)::int as bills, sum(ca.amount)::numeric(14,2) as amount from credit_applications ca join customer_credits cc on cc.id = ca.credit_id
       where cc.customer_id = $1 and cc.source_type = 'SALES_RETURN' and ca.reversed_at is null`,
      [cu],
    );
    assert.deepEqual(used, { bills: 3, amount: "3000.00" });
  });

  it("a return cancel racing a sale that wants its advance: exactly one consistent outcome", async (t) => {
    if (!server) return t.skip("no PostgreSQL available");
    for (let round = 0; round < 5; round++) {
      const cu = await customer(`Cancel Race ${round}`);
      await sale(cu, 2, "2000");
      const r = await ret(cu, 2); // 2,000 advance
      const [cancel, bill] = await Promise.allSettled([
        app.db.transaction((tx) => app.cancelReturn(tx, { id: r.id, version: 1, reason: "Race test cancel" }, user())),
        sale(cu, 2), // would use the 2,000 advance
      ]);
      assert.equal(bill.status, "fulfilled", "the sale always saves");
      const state = await assertConsistent(cu);
      if (cancel.status === "fulfilled") {
        // cancel won: the sale went on credit
        assert.deepEqual(state, { balance: 2000, dues: 2000, credit: 0 });
      } else {
        // sale won: it used the advance, and the cancel was refused for that reason
        assert.match(String((cancel as PromiseRejectedResult).reason?.message), /has since been used on INV\//);
        assert.deepEqual(state, { balance: 0, dues: 0, credit: 0 });
        assert.equal((await one(`select status from sales_return_header where id = $1`, [r.id])).status, "SAVED");
      }
    }
  });
});
