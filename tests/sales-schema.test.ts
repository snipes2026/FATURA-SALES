/**
 * Sales module schema (migrations 0007/0008): constraints, the append-only
 * customer ledger, and the single Walk-in Customer.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { runMigrations, seedBasics, startTestDb } from "./helpers/test-db";

let stop: () => Promise<void>;
let c: pg.Client;

before(async () => {
  const t = await startTestDb();
  stop = t.stop;
  await runMigrations(t.url);
  await seedBasics(t.url);
  c = new pg.Client(t.url);
  await c.connect();
});

after(async () => {
  await c.end();
  await stop();
});

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
const fails = async (sql: string, params: unknown[] = [], re: RegExp = /./) => {
  await assert.rejects(c.query(sql, params), re);
};

describe("sales schema", () => {
  it("creates the default sales_settings row", async () => {
    const s = await one(`select * from sales_settings where id = 1`);
    assert.equal(s.allow_price_edit, false);
    assert.equal(s.auto_increment_qty, true);
    assert.equal(s.allow_negative_stock, false);
  });

  it("allows only one Walk-in Customer, with no opening balance", async () => {
    await c.query(`insert into customers (name, phone, state_code, opening_date, is_walkin) values ('Walk-in Customer','0','27','2026-04-01',true)`);
    await fails(`insert into customers (name, phone, state_code, opening_date, is_walkin) values ('Walk-in 2','0','27','2026-04-01',true)`, [], /customers_walkin_uq/);
    await fails(`update customers set opening_balance = 10 where is_walkin`, [], /customers_walkin_no_opening/);
  });

  it("keeps customer_ledger append-only, except the OPENING row of an unused customer", async () => {
    const cust = await one(`insert into customers (name, phone, state_code, opening_date, opening_balance) values ('A','98','27','2026-04-01',500) returning id`);
    const op = await one(
      `insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, debit) values ($1,'2026-04-01','OPENING',$1,500) returning id`,
      [cust.id],
    );
    // Unused customer: opening can be corrected
    await c.query(`update customer_ledger set debit = 600 where id = $1`, [op.id]);

    const rc = await one(
      `insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, credit) values ($1,'2026-05-01','RECEIPT',1,100) returning id`,
      [cust.id],
    );
    await fails(`update customer_ledger set credit = 1 where id = $1`, [rc.id], /append-only/);
    await fails(`delete from customer_ledger where id = $1`, [rc.id], /append-only/);
    // Once used, even the OPENING row is frozen
    await fails(`update customer_ledger set debit = 700 where id = $1`, [op.id], /append-only/);

    const bal = await one(`select sum(debit - credit)::numeric(14,2) as b from customer_ledger where customer_id = $1`, [cust.id]);
    assert.equal(bal.b, "500.00");
  });

  it("rejects negative ledger amounts and zero receipt modes", async () => {
    const cust = await one(`select id from customers where name = 'A'`);
    await fails(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, debit) values ($1,'2026-05-02','SALE',1,-1)`, [cust.id], /customer_ledger_nonneg/);
  });

  it("requires a bill for BILL allocations only", async () => {
    await fails(
      `insert into receipt_allocations (receipt_id, target_type, amount) values (1,'BILL',10)`,
      [],
      /receipt_allocations_bill_has_sale|foreign key/,
    );
  });
});
