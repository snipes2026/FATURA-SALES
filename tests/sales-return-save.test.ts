/**
 * Save Sales Return on the server (the transaction body the action runs): the
 * worked examples of the spec end to end — stock IN, credit pool, ledger, refund
 * cash-out — and the rules the server enforces whatever the screen sent.
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
  saveReturn: typeof import("../src/app/(app)/sales-returns/_lib/save-return").saveReturn;
  v: typeof import("../src/lib/validation/sales");
  rv: typeof import("../src/lib/validation/sales-return");
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
    saveReturn: (await import("../src/app/(app)/sales-returns/_lib/save-return")).saveReturn,
    v: await import("../src/lib/validation/sales"),
    rv: await import("../src/lib/validation/sales-return"),
    customerAccount: (await import("../src/lib/customers")).customerAccount,
    ActionError: (await import("../src/lib/server-action")).ActionError,
    todayIST: (await import("../src/lib/dates")).todayIST,
    financialYear: (await import("../src/lib/dates")).financialYear,
  };
  c = new pg.Client(t.url);
  await c.connect();
  productId = (await one(`insert into products (department_id, item_name, barcode, purchase_rate, wsp, mrp) values ($1,'Kurta','T000001',500,1000,1999) returning id`, [ids.deptId])).id;
  await c.query(`insert into stock_ledger (location_id, product_id, qty_in, ref_doc_type, ref_doc_id, created_by) values ($1,$2,1000,'GRN',1,$3)`, [ids.locationId, productId, ids.userId]);
  walkinId = (await one(`insert into customers (name, phone, state_code, opening_date, is_walkin) values ('Walk-in Customer','0','27','2026-04-01',true) returning id`)).id;
});

after(async () => {
  await c.end();
  await app.pool.end();
  await stop();
});

const one = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0];
const user = () => ({ id: ids.userId, locations: [{ id: ids.locationId, name: "Main Store", type: "STORE" as const, stateCode: "27" }] });
const tx = <T>(fn: (t: Parameters<Parameters<typeof app.db.transaction>[0]>[0]) => Promise<T>) => app.db.transaction(fn);

async function customer(opening = 0) {
  const id = (
    await one(`insert into customers (name, phone, state_code, opening_balance, opening_type, opening_date) values ($1,'98','27',$2,'DR','2026-04-01') returning id`, [
      `C ${Math.random()}`,
      opening,
    ])
  ).id as number;
  if (opening) await c.query(`insert into customer_ledger (customer_id, entry_date, voucher_type, voucher_id, debit) values ($1,'2026-04-01','OPENING',$1,$2)`, [id, opening]);
  return id;
}

/** qty × ₹1,000 (Includes GST). `manual` = settlement table, e.g. { CURRENT: "1000" }. */
const sale = (customerId: number, qty: number, cash = "", manual: Record<string, string> | null = null) =>
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
        payment: { cash, bank1: "", bank2: "", advanceUsed: null, manual, excess: null },
        expectedNet: `${qty * 1000}.00`,
      }),
      user(),
    ),
  );

type Ret = {
  qty: number;
  rate?: string;
  against?: { salesId: number } | null;
  manual?: Record<string, string> | null;
  remainder?: "ADVANCE" | "REFUND" | null;
  refundMode?: "CASH" | "BANK1" | "BANK2" | null;
  qtyConfirmed?: boolean;
  expectedNet?: string;
};
async function saveReturn(customerId: number, r: Ret) {
  const rate = r.rate ?? "1000.00";
  let originalSalesLineId: number | null = null;
  if (r.against) originalSalesLineId = (await one(`select id from sales_lines where sales_id = $1 and product_id = $2`, [r.against.salesId, productId])).id;
  return tx((t) =>
    app.saveReturn(
      t,
      app.rv.returnSaveSchema.parse({
        customerId,
        locationId: ids.locationId,
        returnDate: app.todayIST(),
        againstSalesId: r.against?.salesId ?? null,
        gstMode: "INCLUDES",
        gstOverride: null,
        roundOff: null,
        lines: [{ productId, qty: r.qty, rate, originalSalesLineId }],
        adjustment: { manual: r.manual ?? null, remainder: r.remainder ?? null, refundMode: r.refundMode ?? null },
        qtyConfirmed: r.qtyConfirmed ?? false,
        remarks: "",
        expectedNet: r.expectedNet ?? (Number(rate) * r.qty).toFixed(2),
      }),
      user(),
    ),
  );
}

async function position(id: number) {
  const a = await app.customerAccount(app.db, id);
  const dues = a.dues.reduce((s, d) => s + d.pending, 0);
  assert.equal(dues - a.advanceAvailable, a.balancePaise, "Σ dues − advance = ledger balance");
  assert.ok(!(dues > 0 && a.advanceAvailable > 0), "never both Dr and Cr");
  return { balance: a.balancePaise / 100, dues: a.dues.map((d) => [d.ref.startsWith("INV") ? "BILL" : d.ref, d.pending / 100]), advance: a.advanceAvailable / 100 };
}
const stock = async () => (await one(`select sum(qty_in - qty_out)::int as q from stock_ledger where product_id = $1 and location_id = $2`, [productId, ids.locationId])).q as number;

describe("saveReturn — the worked examples", () => {
  it("pending bill 10,000, return 4,000 against it → bill pending 6,000, balance 6,000 Dr; stock back; ledger Cr", async () => {
    const cu = await customer();
    const b = await sale(cu, 10);
    const s0 = await stock();
    const r = await saveReturn(cu, { qty: 4, against: { salesId: b.id } });
    assert.equal(r.returnNo, `SR/${app.financialYear(app.todayIST())}/0001`);
    assert.deepEqual(await position(cu), { balance: 6000, dues: [["BILL", 6000]], advance: 0 });
    assert.equal(await stock(), s0 + 4);
    const st = await one(`select ref_doc_type, qty_in from stock_ledger where ref_doc_type = 'SALES_RETURN' and ref_doc_id = $1`, [r.id]);
    assert.deepEqual(st, { ref_doc_type: "SALES_RETURN", qty_in: 4 });
    const led = await one(`select debit, credit, particulars from customer_ledger where voucher_type = 'SALES_RETURN' and voucher_id = $1`, [r.id]);
    assert.equal(led.credit, "4000.00");
    assert.match(led.particulars, /^Return against INV\/.*; applied to INV\/.* ₹4,000\.00 — 4 pcs$/);
    const h = await one(`select applied_to_dues, advance_created, refund_amount, prev_balance, balance_after, against_sales_id from sales_return_header where id = $1`, [r.id]);
    assert.deepEqual(h, { applied_to_dues: "4000.00", advance_created: "0.00", refund_amount: "0.00", prev_balance: "10000.00", balance_after: "6000.00", against_sales_id: b.id });
    const cr = await one(`select amount, remaining from customer_credits where source_type = 'SALES_RETURN' and source_id = $1`, [r.id]);
    assert.deepEqual(cr, { amount: "4000.00", remaining: "0.00" });
    // the line copies the bill's GST rate
    assert.equal((await one(`select gst_rate, original_sales_line_id is not null as linked from sales_return_lines where return_id = $1`, [r.id])).gst_rate, "5.00");
  });

  it("pending bill 10,000, return 10,000 → bill cleared, balance Nil", async () => {
    const cu = await customer();
    const b = await sale(cu, 10);
    await saveReturn(cu, { qty: 10, against: { salesId: b.id } });
    assert.deepEqual(await position(cu), { balance: 0, dues: [], advance: 0 });
  });

  it("pending bill 3,000, return 5,000 → bill cleared, 2,000 advance (return credit), balance 2,000 Cr", async () => {
    const cu = await customer();
    await sale(cu, 2, "2000"); // paid
    await sale(cu, 3); // 3,000 pending
    const r = await saveReturn(cu, { qty: 5 });
    assert.deepEqual(await position(cu), { balance: -2000, dues: [], advance: 2000 });
    assert.equal((await app.customerAccount(app.db, cu)).advanceFromReturns, 200000);
    assert.equal((await one(`select advance_created from sales_return_header where id = $1`, [r.id])).advance_created, "2000.00");
  });

  it("no dues, return 5,000 → 5,000 advance, balance 5,000 Cr", async () => {
    const cu = await customer();
    await sale(cu, 5, "5000");
    await saveReturn(cu, { qty: 5 });
    assert.deepEqual(await position(cu), { balance: -5000, dues: [], advance: 5000 });
  });

  it("opening balance 20,000 Dr, return 5,000 → opening reduced, 15,000 Dr (needs the qty warning confirmed)", async () => {
    const cu = await customer(20000);
    // never sold to this customer → Warn mode refuses until confirmed
    await assert.rejects(saveReturn(cu, { qty: 5 }), /never sold to this customer/);
    await saveReturn(cu, { qty: 5, qtyConfirmed: true });
    assert.deepEqual(await position(cu), { balance: 15000, dues: [["Opening balance", 15000]], advance: 0 });
    const app1 = await one(`select ca.target_type, ca.amount from credit_applications ca join customer_credits cc on cc.id = ca.credit_id where cc.customer_id = $1`, [cu]);
    assert.deepEqual(app1, { target_type: "OPENING", amount: "5000.00" });
  });

  it("return 3,000 against the newer bill (pending 2,000) with an older bill at 9,000 → newer 2,000 first, then 1,000 to the older", async () => {
    const cu = await customer();
    await sale(cu, 9); // older, 9,000 pending
    const newer = await sale(cu, 3, "1000", { CURRENT: "1000" }); // 1,000 paid on the new bill itself → 2,000 pending
    assert.deepEqual(await position(cu), { balance: 11000, dues: [["BILL", 9000], ["BILL", 2000]], advance: 0 });
    await saveReturn(cu, { qty: 3, against: { salesId: newer.id } });
    assert.deepEqual(await position(cu), { balance: 8000, dues: [["BILL", 8000]], advance: 0 });
  });

  it("return 5,000 with Refund now (Cash) → no advance, cash out 5,000, balance unchanged", async () => {
    const cu = await customer();
    await sale(cu, 5, "5000");
    const r = await saveReturn(cu, { qty: 5, remainder: "REFUND", refundMode: "CASH" });
    assert.deepEqual(await position(cu), { balance: 0, dues: [], advance: 0 });
    const out = await one(`select mode, direction, amount from cash_bank_ledger where ref_type = 'SALES_RETURN' and ref_id = $1`, [r.id]);
    assert.deepEqual(out, { mode: "CASH", direction: "OUT", amount: "5000.00" });
    const rows = (await c.query(`select voucher_type, debit, credit from customer_ledger where voucher_id = $1 and voucher_type in ('SALES_RETURN','REFUND') order by id`, [r.id])).rows;
    assert.deepEqual(rows, [
      { voucher_type: "SALES_RETURN", debit: "0.00", credit: "5000.00" },
      { voucher_type: "REFUND", debit: "5000.00", credit: "0.00" },
    ]);
  });

  it("Walk-in Customer returns 800 → refund forced (Bank 1 here), never an advance", async () => {
    await sale(walkinId, 1, "1000");
    const r = await saveReturn(walkinId, { qty: 1, rate: "800.00", remainder: "ADVANCE", refundMode: "BANK1" });
    assert.equal(r.refund, 80000);
    assert.deepEqual(await position(walkinId), { balance: 0, dues: [], advance: 0 });
    const out = await one(`select mode, amount from cash_bank_ledger where ref_type = 'SALES_RETURN' and ref_id = $1`, [r.id]);
    assert.deepEqual(out, { mode: "BANK1", amount: "800.00" });
  });
});

describe("saveReturn — server checks", () => {
  it("refuses a total that differs from the screen, an item not on the bill, and an advance while bills stay pending", async () => {
    const cu = await customer();
    const b = await sale(cu, 2);
    await assert.rejects(saveReturn(cu, { qty: 1, expectedNet: "999.00" }), (e: unknown) => e instanceof app.ActionError && e.code === "MISMATCH");
    const other = await sale(cu, 1);
    // a line pointing at another bill's line is "not on" the chosen bill
    const lineOfOther = (await one(`select id from sales_lines where sales_id = $1`, [other.id])).id;
    await assert.rejects(
      tx((t) =>
        app.saveReturn(
          t,
          app.rv.returnSaveSchema.parse({
            customerId: cu,
            locationId: ids.locationId,
            returnDate: app.todayIST(),
            againstSalesId: b.id,
            gstMode: "INCLUDES",
            gstOverride: null,
            roundOff: null,
            lines: [{ productId, qty: 1, rate: "1000.00", originalSalesLineId: lineOfOther }],
            adjustment: { manual: null, remainder: null, refundMode: null },
            qtyConfirmed: false,
            remarks: "",
            expectedNet: "1000.00",
          }),
          user(),
        ),
      ),
      /is not on INV\//,
    );
    // edited split leaving 2,000 + 1,000 pending, rest as advance → refused (never Dr and Cr)
    await assert.rejects(saveReturn(cu, { qty: 1, manual: { [`BILL:${b.id}`]: "0" }, remainder: "ADVANCE" }), /apply the return to them before keeping an advance/);
    assert.equal((await one(`select count(*)::int as n from sales_return_header where customer_id = $1`, [cu])).n, 0);
  });

  it("Block mode refuses more than was sold; Off mode doesn't check", async () => {
    const cu = await customer();
    await sale(cu, 1, "1000");
    await c.query(`update sales_settings set return_qty_check = 'BLOCK' where id = 1`);
    try {
      await assert.rejects(saveReturn(cu, { qty: 2, qtyConfirmed: true }), /returning 2, but only 1 can be returned/);
      await saveReturn(cu, { qty: 1 });
      await assert.rejects(saveReturn(cu, { qty: 1 }), /only 0 can be returned \(sold 1, already returned 1\)/);
      await c.query(`update sales_settings set return_qty_check = 'OFF' where id = 1`);
      await saveReturn(cu, { qty: 3 });
    } finally {
      await c.query(`update sales_settings set return_qty_check = 'WARN' where id = 1`);
    }
  });
});
