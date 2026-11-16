/**
 * Migration 0010/0011: advances move into the credit pool (customer_credits /
 * credit_applications) and advance_adjustments is dropped. Every customer's
 * pending bills, advance and ledger balance must be the same before and after.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { runMigrations, seedBasics, startTestDb } from "./helpers/test-db";

let stop: () => Promise<void>;
let url: string;
let c: pg.Client;
let ids: Awaited<ReturnType<typeof seedBasics>>;
let app: {
  db: typeof import("../src/db").db;
  pool: typeof import("../src/db").pool;
  customerAccount: typeof import("../src/lib/customers").customerAccount;
};

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
let seq = 0;

// ---- legacy (0009) data, written the way the old code wrote it
async function customer(opening = 0, type: "DR" | "CR" = "DR") {
  const cu = await one(
    `insert into customers (name, phone, state_code, opening_balance, opening_type, opening_date) values ($1,'9','27',$2,$3,'2026-04-01') returning id`,
    [`C${++seq}`, opening, type],
  );
  if (opening > 0)
    await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, debit, credit) values ($1,'2026-04-01','OPENING',$1,$2,$3)`, [
      cu.id,
      type === "DR" ? opening : 0,
      type === "CR" ? opening : 0,
    ]);
  return cu.id as number;
}
async function bill(customerId: number, date: string, net: number) {
  const h = await one(
    `insert into sales_header (bill_no, fy, bill_date, customer_id, location_id, customer_name, customer_state_code, gst_mode, tax_type, total_qty, gross, taxable, gst_amount, net_amount, created_by)
     values ($1,'26-27',$2,$3,$4,'X','27','INCLUDES','INTRA',1,$5,$5,0,$5,$6) returning id`,
    [`INV/${++seq}`, date, customerId, ids.locationId, net, ids.userId],
  );
  await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, debit) values ($1,$2,'SALE',$3,$4)`, [customerId, date, h.id, net]);
  return h.id as number;
}
async function cancelBill(customerId: number, id: number, net: number) {
  await c.query(`update sales_header set status = 'CANCELLED', cancel_reason = 'test' where id = $1`, [id]);
  await c.query(`update advance_adjustments set reversed_at = now() where sales_id = $1`, [id]);
  await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, credit) values ($1,'2026-09-01','SALE_CANCEL',$2,$3)`, [customerId, id, net]);
}
async function receipt(customerId: number, date: string, allocs: { type: "OPENING" | "BILL" | "ADVANCE"; salesId?: number; amount: number }[]) {
  const total = allocs.reduce((a, x) => a + x.amount, 0);
  const r = await one(
    `insert into receipts (receipt_no, fy, receipt_date, customer_id, location_id, source, total_amount, created_by) values ($1,'26-27',$2,$3,$4,'STANDALONE',$5,$6) returning id`,
    [`RCT/${++seq}`, date, customerId, ids.locationId, total, ids.userId],
  );
  for (const a of allocs) await c.query(`insert into receipt_allocations (receipt_id, target_type, sales_id, amount) values ($1,$2,$3,$4)`, [r.id, a.type, a.salesId ?? null, a.amount]);
  await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, credit) values ($1,$2,'RECEIPT',$3,$4)`, [customerId, date, r.id, total]);
  return r.id as number;
}
async function cancelReceipt(customerId: number, id: number, total: number) {
  await c.query(`update receipts set status = 'CANCELLED', cancel_reason = 'test' where id = $1`, [id]);
  await c.query(`update receipt_allocations set reversed_at = now() where receipt_id = $1`, [id]);
  await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, debit) values ($1,'2026-09-01','RECEIPT_CANCEL',$2,$3)`, [customerId, id, total]);
}
async function adjust(customerId: number, salesId: number, amount: number) {
  await c.query(`insert into advance_adjustments (customer_id, sales_id, adj_date, amount, created_by) values ($1,$2,'2026-08-01',$3,$4)`, [customerId, salesId, amount, ids.userId]);
}

/** The old (0009) bill-wise position, straight from SQL. Rupees. */
async function legacyPosition(id: number) {
  const cu = await one(`select opening_balance::float as ob, opening_type from customers where id = $1`, [id]);
  const alloc = async (t: string) =>
    Number(
      (
        await one(
          `select coalesce(sum(ra.amount),0)::float as s from receipt_allocations ra join receipts r on r.id = ra.receipt_id where r.customer_id = $1 and ra.reversed_at is null and ra.target_type = $2`,
          [id, t],
        )
      ).s,
    );
  const adj = Number((await one(`select coalesce(sum(amount),0)::float as s from advance_adjustments where customer_id = $1 and reversed_at is null`, [id])).s);
  const bills = (
    await c.query(
      `select h.id, (h.net_amount
          - coalesce((select sum(amount) from receipt_allocations where sales_id = h.id and target_type = 'BILL' and reversed_at is null),0)
          - coalesce((select sum(amount) from advance_adjustments where sales_id = h.id and reversed_at is null),0))::float as p
       from sales_header h where h.customer_id = $1 and h.status = 'SAVED' order by h.id`,
      [id],
    )
  ).rows.filter((r) => r.p > 0);
  const opening = cu.opening_type === "DR" ? cu.ob - (await alloc("OPENING")) : 0;
  return {
    dues: [...(opening > 0 ? [["OPENING", opening]] : []), ...bills.map((b) => [`BILL:${b.id}`, b.p])],
    advance: (cu.opening_type === "CR" ? cu.ob : 0) + (await alloc("ADVANCE")) - adj,
    balance: Number((await one(`select coalesce(sum(debit - credit),0)::float as b from customer_ledger where customer_id = $1`, [id])).b),
  };
}

const people: Record<string, number> = {};
const legacy: Record<string, Awaited<ReturnType<typeof legacyPosition>>> = {};

before(async () => {
  const t = await startTestDb();
  stop = t.stop;
  url = t.url;
  await runMigrations(url, 10); // 0000 … 0009 — the database as Sales left it
  ids = await seedBasics(url);
  c = new pg.Client(url);
  await c.connect();

  // A: opening Cr 500, used on an 800 bill → bill pending 300, no advance
  people.A = await customer(500, "CR");
  await adjust(people.A, await bill(people.A, "2026-05-01", 800), 500);

  // B: opening Dr 1000 paid with a 1700 receipt (700 advance); 400 of it used on a 1000 bill;
  //    a second 200 advance whose receipt was cancelled
  people.B = await customer(1000, "DR");
  await receipt(people.B, "2026-05-02", [
    { type: "OPENING", amount: 1000 },
    { type: "ADVANCE", amount: 700 },
  ]);
  await adjust(people.B, await bill(people.B, "2026-06-01", 1000), 400);
  await cancelReceipt(people.B, await receipt(people.B, "2026-06-02", [{ type: "ADVANCE", amount: 200 }]), 200);

  // C: 1000 advance, used on a 600 bill that was then cancelled → advance 1000 again
  people.C = await customer();
  await receipt(people.C, "2026-05-03", [{ type: "ADVANCE", amount: 1000 }]);
  const cBill = await bill(people.C, "2026-05-04", 600);
  await adjust(people.C, cBill, 600);
  await cancelBill(people.C, cBill, 600);

  // D: one adjustment spanning two credits (opening Cr 300 + advance 400 → 600 used)
  people.D = await customer(300, "CR");
  await receipt(people.D, "2026-05-05", [{ type: "ADVANCE", amount: 400 }]);
  await adjust(people.D, await bill(people.D, "2026-05-06", 900), 600);

  // E: plain debtor, nothing to move
  people.E = await customer(2500, "DR");
  await bill(people.E, "2026-05-07", 1200);

  for (const [k, id] of Object.entries(people)) legacy[k] = await legacyPosition(id);

  await runMigrations(url); // 0010 + 0011
  process.env.DATABASE_URL = url;
  process.env.DB_POOL_MAX = "1";
  const dbm = await import("../src/db");
  app = { db: dbm.db, pool: dbm.pool, customerAccount: (await import("../src/lib/customers")).customerAccount };
});

after(async () => {
  await c.end();
  await app?.pool.end();
  await stop();
});

describe("migration 0010/0011 — advances into the credit pool", () => {
  it("the legacy positions are what the scenario intends", () => {
    assert.deepEqual(legacy.A, { dues: [[legacy.A.dues[0][0], 300]], advance: 0, balance: 300 });
    assert.equal(legacy.B.advance, 300);
    assert.equal(legacy.C.advance, 1000);
    assert.equal(legacy.D.advance, 100);
  });

  it("every customer's pending bills, advance and balance are unchanged", async () => {
    for (const [k, id] of Object.entries(people)) {
      const a = await app.customerAccount(app.db, id);
      const now = { dues: a.dues.map((d) => [d.key, d.pending / 100]), advance: a.advanceAvailable / 100, balance: a.balancePaise / 100 };
      assert.deepEqual(now, legacy[k], `customer ${k}`);
      assert.equal(a.dues.reduce((s, d) => s + d.pending, 0) - a.advanceAvailable, a.balancePaise, `customer ${k}: Σ dues − advance = balance`);
      assert.equal(a.advanceFromReturns, 0);
    }
  });

  it("builds the pool rows: one credit per source, applications split across credits", async () => {
    const credits = (await c.query(`select source_type, amount::float, remaining::float, reversed_at is not null as rev from customer_credits where customer_id = $1 order by id`, [people.B])).rows;
    assert.deepEqual(credits, [
      { source_type: "ADVANCE", amount: 700, remaining: 300, rev: false },
      { source_type: "ADVANCE", amount: 200, remaining: 0, rev: true },
    ]);
    const dApps = (
      await c.query(
        `select cc.source_type, ca.amount::float from credit_applications ca join customer_credits cc on cc.id = ca.credit_id where ca.customer_id = $1 and ca.reversed_at is null order by ca.id`,
        [people.D],
      )
    ).rows;
    assert.deepEqual(dApps, [
      { source_type: "OPENING_CR", amount: 300 },
      { source_type: "ADVANCE", amount: 300 },
    ]);
    // C's cancelled-bill adjustment is kept as reversed history
    const cApps = (await c.query(`select reversed_at is not null as rev from credit_applications where customer_id = $1`, [people.C])).rows;
    assert.deepEqual(cApps, [{ rev: true }]);
  });

  it("drops advance_adjustments and adds the Sales Return tables and settings", async () => {
    assert.equal((await one(`select to_regclass('advance_adjustments') as t`)).t, null);
    for (const t of ["sales_return_header", "sales_return_lines", "customer_credits", "credit_applications"])
      assert.equal((await one(`select to_regclass($1) as t`, [t])).t, t);
    const s = await one(`select return_qty_check, return_prefix, return_digits, return_print_format from sales_settings where id = 1`);
    assert.deepEqual(s, { return_qty_check: "WARN", return_prefix: "SR", return_digits: 4, return_print_format: "A4" });
  });

  it("enforces the pool constraints", async () => {
    const cr = await one(`select id from customer_credits where customer_id = $1 and reversed_at is null limit 1`, [people.B]);
    await assert.rejects(c.query(`update customer_credits set remaining = amount + 1 where id = $1`, [cr.id]), /customer_credits_remaining_range/);
    await assert.rejects(c.query(`update customer_credits set remaining = -1 where id = $1`, [cr.id]), /customer_credits_remaining_range/);
    await assert.rejects(c.query(`update customer_credits set reversed_at = now() where id = $1`, [cr.id]), /customer_credits_reversed_empty/);
    await assert.rejects(
      c.query(`insert into credit_applications (credit_id, customer_id, target_type, applied_date, amount) values ($1,$2,'BILL','2026-09-01',10)`, [cr.id, people.B]),
      /credit_applications_bill_has_sale/,
    );
  });
});
