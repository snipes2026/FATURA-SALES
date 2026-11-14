/**
 * Save Sale on the server (the transaction body the action runs): numbering,
 * stock out, receipt / allocations / ledgers, advance, change, and the rules
 * the server enforces regardless of what the screen sent.
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
  saleSaveSchema: typeof import("../src/lib/validation/sales").saleSaveSchema;
  customerAccount: typeof import("../src/lib/customers").customerAccount;
  ActionError: typeof import("../src/lib/server-action").ActionError;
  todayIST: typeof import("../src/lib/dates").todayIST;
  financialYear: typeof import("../src/lib/dates").financialYear;
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
    saleSaveSchema: (await import("../src/lib/validation/sales")).saleSaveSchema,
    customerAccount: (await import("../src/lib/customers")).customerAccount,
    ActionError: (await import("../src/lib/server-action")).ActionError,
    todayIST: (await import("../src/lib/dates")).todayIST,
    financialYear: (await import("../src/lib/dates")).financialYear,
  };
  c = new pg.Client(t.url);
  await c.connect();
  const p = await one(
    `insert into products (department_id, item_name, barcode, purchase_rate, wsp, mrp) values ($1,'Shirt','T000001',100,150,299) returning id`,
    [ids.deptId],
  );
  productId = p.id;
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

async function newCustomer(opening = 0) {
  const cu = await one(
    `insert into customers (name, phone, state_code, opening_balance, opening_type, opening_date) values ($1,'98','27',$2,'DR','2026-04-01') returning id`,
    [`Cust ${Math.random()}`, opening],
  );
  if (opening) await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, debit) values ($1,'2026-04-01','OPENING',$1,$2)`, [cu.id, opening]);
  return cu.id as number;
}

type Pay = { cash?: string; bank1?: string; advanceUsed?: string | null; manual?: Record<string, string> | null; excess?: "ADVANCE" | "CHANGE" | null };
function input(customerId: number, qty: number, expectedNet: string, pay: Pay = {}, rate = "150.00") {
  return app.saleSaveSchema.parse({
    customerId,
    locationId: ids.locationId,
    billDate: app.todayIST(),
    gstMode: "INCLUDES",
    gstOverride: null,
    roundOff: null,
    lines: [{ productId, qty, rate }],
    payment: { cash: pay.cash ?? "", bank1: pay.bank1 ?? "", bank2: "", advanceUsed: pay.advanceUsed ?? null, manual: pay.manual ?? null, excess: pay.excess ?? null },
    expectedNet,
  });
}
const save = (i: ReturnType<typeof input>) => app.db.transaction((tx) => app.saveSale(tx, i, user()));
const balance = async (id: number) => (await one(`select coalesce(sum(debit - credit),0)::numeric(14,2) as b from customer_ledger where customer_id = $1`, [id])).b;
const stock = async () => (await one(`select sum(qty_in - qty_out)::int as q from stock_ledger where product_id = $1 and location_id = $2`, [productId, ids.locationId])).q;

describe("saveSale", () => {
  it("Walk-in: cash with change — bill number, stock out, receipt of the bill amount only", async () => {
    const r = await save(input(walkinId, 1, "150.00", { cash: "200", excess: "CHANGE" }));
    assert.equal(r.billNo, `INV/${app.financialYear(app.todayIST())}/0001`);
    assert.equal(r.change, 5000);
    assert.equal(await stock(), 499);
    const h = await one(`select * from sales_header where id = $1`, [r.id]);
    assert.equal(h.net_amount, "150.00");
    assert.equal(h.taxable, "142.86");
    assert.equal(h.cash_tendered, "200.00");
    assert.equal(h.change_returned, "50.00");
    assert.equal(h.credit_amount, "0.00");
    const rc = await one(`select * from receipts where sales_id = $1`, [r.id]);
    assert.equal(rc.total_amount, "150.00");
    assert.equal((await one(`select amount from receipt_modes where receipt_id = $1 and mode = 'CASH'`, [rc.id])).amount, "150.00");
    assert.equal((await one(`select sum(amount)::numeric(14,2) as s from cash_bank_ledger where ref_id = $1 and ref_type = 'RECEIPT'`, [rc.id])).s, "150.00");
    assert.equal(await balance(walkinId), "0.00");
  });

  it("example 2: previous 20,000 (opening), bill 15,000, cash 20,000 → opening settled, credit 15,000", async () => {
    const id = await newCustomer(20000);
    const r = await save(input(id, 100, "15000.00", { cash: "20000" }));
    const h = await one(`select * from sales_header where id = $1`, [r.id]);
    assert.equal(h.credit_amount, "15000.00");
    assert.equal(h.prev_balance, "20000.00");
    assert.equal(h.balance_after, "15000.00");
    const allocs = (await c.query(`select ra.target_type, ra.amount from receipt_allocations ra join receipts r on r.id = ra.receipt_id where r.customer_id = $1`, [id])).rows;
    assert.deepEqual(allocs, [{ target_type: "OPENING", amount: "20000.00" }]);
    assert.equal(await balance(id), "15000.00");
    const acc = await app.customerAccount(app.db, id);
    assert.deepEqual(
      acc.dues.map((d) => [d.kind, d.pending]),
      [["BILL", 1500000]],
    );
  });

  it("excess kept as advance, then used to pay the next bill", async () => {
    const id = await newCustomer();
    await save(input(id, 1, "150.00", { cash: "1000", excess: "ADVANCE" }));
    assert.equal(await balance(id), "-850.00");
    const acc = await app.customerAccount(app.db, id);
    assert.equal(acc.advanceAvailable, 85000);

    const r2 = await save(input(id, 2, "300.00")); // advance used by default, nothing received
    assert.equal(r2.receiptNo, null);
    const h = await one(`select * from sales_header where id = $1`, [r2.id]);
    assert.equal(h.advance_used, "300.00");
    assert.equal(h.credit_amount, "0.00");
    assert.equal(await balance(id), "-550.00");
    const after = await app.customerAccount(app.db, id);
    assert.equal(after.advanceAvailable, 55000);
    assert.equal(after.dues.length, 0);
    const settle = await one(`select * from customer_ledger where voucher_type = 'SETTLEMENT' and voucher_id = $1`, [r2.id]);
    assert.equal(settle.debit, "0.00");
  });

  it("forces the WSP when price edit is off (client price ignored)", async () => {
    const r = await save(input(walkinId, 1, "150.00", { cash: "150" }, "1.00"));
    assert.equal((await one(`select rate from sales_lines where sales_id = $1`, [r.id])).rate, "150.00");
  });

  it("refuses a bill whose total differs from what the screen showed", async () => {
    await assert.rejects(save(input(walkinId, 1, "149.00", { cash: "150" })), (e: unknown) => e instanceof app.ActionError && e.code === "MISMATCH");
  });

  it("refuses more than the stock, and credit for Walk-in — nothing is written", async () => {
    const before = await stock();
    const bills = (await one(`select count(*)::int as n from sales_header`)).n;
    await assert.rejects(save(input(walkinId, 10000, "1500000.00", { cash: "1500000" })), /only \d+ in stock/);
    await assert.rejects(save(input(walkinId, 1, "150.00", { cash: "100" })), /Walk-in Customer can't buy on credit/);
    assert.equal(await stock(), before);
    assert.equal((await one(`select count(*)::int as n from sales_header`)).n, bills);
    // the failed saves used no numbers
    const r = await save(input(walkinId, 1, "150.00", { cash: "150" }));
    assert.equal(r.billNo.endsWith(String(bills + 1).padStart(4, "0")), true);
  });

  it("ledger: Sale Dr + Receipt Cr per allocation, and balance = Σ dues − advance", async () => {
    const id = await newCustomer(1000);
    const r = await save(input(id, 2, "300.00", { cash: "500", bank1: "200" })); // 700: 1000 opening first → all to opening, credit 300
    const rows = (await c.query(`select voucher_type, debit, credit from customer_ledger where customer_id = $1 order by id`, [id])).rows;
    assert.deepEqual(rows, [
      { voucher_type: "OPENING", debit: "1000.00", credit: "0.00" },
      { voucher_type: "SALE", debit: "300.00", credit: "0.00" },
      { voucher_type: "RECEIPT", debit: "0.00", credit: "700.00" },
    ]);
    const modes = (await c.query(`select mode, amount from receipt_modes rm join receipts r on r.id = rm.receipt_id where r.sales_id = $1 order by mode`, [r.id])).rows;
    assert.deepEqual(modes, [
      { mode: "CASH", amount: "500.00" },
      { mode: "BANK1", amount: "200.00" },
    ]);
    const acc = await app.customerAccount(app.db, id);
    assert.equal(acc.dues.reduce((a, d) => a + d.pending, 0) - acc.advanceAvailable, acc.balancePaise);
    assert.equal(acc.balancePaise, 60000);
  });
});
