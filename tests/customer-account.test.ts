/**
 * customerAccount(): bill-wise pending + unused advance, and the invariant
 * Σ pending − advance = ledger balance.
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
  customerAccount: typeof import("../src/lib/customers").customerAccount;
};

before(async () => {
  const t = await startTestDb();
  stop = t.stop;
  await runMigrations(t.url);
  ids = await seedBasics(t.url);
  process.env.DATABASE_URL = t.url;
  process.env.DB_POOL_MAX = "1";
  const dbm = await import("../src/db");
  app = { db: dbm.db, pool: dbm.pool, customerAccount: (await import("../src/lib/customers")).customerAccount };
  c = new pg.Client(t.url);
  await c.connect();
});

after(async () => {
  await c.end();
  await app.pool.end();
  await stop();
});

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
let billSeq = 0;

async function customer(opening: number, type: "DR" | "CR") {
  const cu = await one(
    `insert into customers (name, phone, state_code, opening_balance, opening_type, opening_date) values ($1,'9','27',$2,$3,'2026-04-01') returning id`,
    [`C${Math.random()}`, opening, type],
  );
  if (opening > 0)
    await c.query(
      `insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, debit, credit) values ($1,'2026-04-01','OPENING',$1,$2,$3)`,
      [cu.id, type === "DR" ? opening : 0, type === "CR" ? opening : 0],
    );
  return cu.id as number;
}

async function bill(customerId: number, date: string, net: number) {
  billSeq++;
  const h = await one(
    `insert into sales_header (bill_no, fy, bill_date, customer_id, location_id, customer_name, customer_state_code, gst_mode, tax_type,
       total_qty, gross, taxable, gst_amount, net_amount, created_by)
     values ($1,'26-27',$2,$3,$4,'X','27','INCLUDES','INTRA',1,$5,$5,0,$5,$6) returning id`,
    [`INV/${billSeq}`, date, customerId, ids.locationId, net, ids.userId],
  );
  await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, debit) values ($1,$2,'SALE',$3,$4)`, [customerId, date, h.id, net]);
  return h.id as number;
}

async function receipt(customerId: number, date: string, allocs: { type: "OPENING" | "BILL" | "ADVANCE"; salesId?: number; amount: number }[]) {
  billSeq++;
  const total = allocs.reduce((a, x) => a + x.amount, 0);
  const r = await one(
    `insert into receipts (receipt_no, fy, receipt_date, customer_id, location_id, source, total_amount, created_by)
     values ($1,'26-27',$2,$3,$4,'STANDALONE',$5,$6) returning id`,
    [`RCT/${billSeq}`, date, customerId, ids.locationId, total, ids.userId],
  );
  for (const a of allocs)
    await c.query(`insert into receipt_allocations (receipt_id, target_type, sales_id, amount) values ($1,$2,$3,$4)`, [r.id, a.type, a.salesId ?? null, a.amount]);
  await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, credit) values ($1,$2,'RECEIPT',$3,$4)`, [customerId, date, r.id, total]);
  return r.id as number;
}

const rupees = (p: number) => p / 100;
async function check(id: number) {
  const a = await app.customerAccount(app.db, id);
  const pending = a.dues.reduce((s, d) => s + d.pending, 0);
  assert.equal(pending - a.advanceAvailable, a.balancePaise, "Σ pending − advance must equal the ledger balance");
  return { dues: a.dues.map((d) => [d.key.startsWith("BILL") ? "BILL" : d.key, rupees(d.pending)]), advance: rupees(a.advanceAvailable), balance: rupees(a.balancePaise) };
}

describe("customerAccount", () => {
  it("tracks opening + bills + receipts + advance + advance adjustment", async () => {
    const id = await customer(10000, "DR");
    assert.deepEqual(await check(id), { dues: [["OPENING", 10000]], advance: 0, balance: 10000 });

    const a = await bill(id, "2026-05-01", 5000);
    const b = await bill(id, "2026-06-01", 3000);
    await receipt(id, "2026-06-05", [
      { type: "OPENING", amount: 4000 },
      { type: "BILL", salesId: a, amount: 5000 },
    ]);
    assert.deepEqual(await check(id), { dues: [["OPENING", 6000], ["BILL", 3000]], advance: 0, balance: 9000 });

    await receipt(id, "2026-07-01", [
      { type: "OPENING", amount: 6000 },
      { type: "BILL", salesId: b, amount: 3000 },
      { type: "ADVANCE", amount: 1000 },
    ]);
    assert.deepEqual(await check(id), { dues: [], advance: 1000, balance: -1000 });

    const cBill = await bill(id, "2026-08-01", 2500);
    const adj = await one(`insert into advance_adjustments (customer_id, sales_id, adj_date, amount, created_by) values ($1,$2,'2026-08-01',1000,$3) returning id`, [id, cBill, ids.userId]);
    assert.deepEqual(await check(id), { dues: [["BILL", 1500]], advance: 0, balance: 1500 });

    // Reversed rows no longer count
    await c.query(`update advance_adjustments set reversed_at = now() where id = $1`, [adj.id]);
    assert.deepEqual(await check(id), { dues: [["BILL", 2500]], advance: 1000, balance: 1500 });
  });

  it("an opening Cr balance is an advance; cancelled bills are not pending", async () => {
    const id = await customer(500, "CR");
    assert.deepEqual(await check(id), { dues: [], advance: 500, balance: -500 });
    const x = await bill(id, "2026-05-01", 800);
    await c.query(`update sales_header set status = 'CANCELLED', cancel_reason = 'test' where id = $1`, [x]);
    await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, credit) values ($1,'2026-05-02','SALE_CANCEL',$2,800)`, [id, x]);
    assert.deepEqual(await check(id), { dues: [], advance: 500, balance: -500 });
  });
});
