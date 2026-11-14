/**
 * Migration 0004/0005 on a database that already has GRNs from the old design
 * (item-wise GST, GST on freight, supplier invoice total): every old GRN must
 * keep the same Net Amount, and must still load the way the screens/print use it.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { runMigrations, seedBasics, startTestDb } from "./helpers/test-db";

let stop: () => Promise<void>;
let url: string;
let oldGrnId: number;
const OLD_NET = "23604.00";

before(async () => {
  const t = await startTestDb();
  stop = t.stop;
  url = t.url;
  await runMigrations(url, 4); // 0000–0003 = the schema before this change
  const ids = await seedBasics(url);

  // An old-style saved GRN (numbers from a real GRN entered before the change):
  // gross 27307.50 − 20% = 21846.00 taxable, item GST 1092.30 + freight 500 with 18% GST (90)
  // + other charges 75.50, round off +0.20  →  net 23604.00
  const c = new pg.Client(url);
  await c.connect();
  const h = await c.query(
    `insert into grn_header (grn_no, fy, grn_date, status, location_id, supplier_id, invoice_no, invoice_date, tax_type,
       total_qty, gross_amount, discount_type, discount_value, discount_amount, taxable_value,
       cgst_amount, sgst_amount, igst_amount, charges_amount, charges_gst_amount, round_off, net_payable,
       supplier_invoice_total, created_by, saved_at)
     values ('GRN/26-27/0001','26-27','2026-11-13','SAVED',$1,$2,'SFH/1042','2026-11-10','INTER',
       20, 27307.50, 'PERCENT', 20, 5461.50, 21846.00,
       0, 0, 1182.30, 575.50, 90.00, 0.20, ${OLD_NET},
       23604.00, $3, now())
     returning id`,
    [ids.locationId, ids.supInter, ids.userId],
  );
  oldGrnId = h.rows[0].id;
  await c.query(
    `insert into grn_lines (grn_id, line_no, department_id, hsn_code, item_name, qty, purchase_rate, amount, discount_amount, taxable_value,
       gst_rate, cgst_amount, sgst_amount, igst_amount, gst_amount, mrp)
     values ($1,1,$2,'6205','Denim Jeans Stretch',5,3000,15000,3000,12000, 5,0,0,600,600, 2800),
            ($1,2,$2,'6205','Formal Trousers',15,820.50,12307.50,2461.50,9846, 5,0,0,492.30,492.30, 1599)`,
    [oldGrnId, ids.deptId],
  );
  await c.query(
    `insert into grn_charges (grn_id, charge_type, amount, gst_applicable, gst_rate, gst_amount)
     values ($1,'FREIGHT',500,true,18,90), ($1,'OTHER',75.50,false,0,0)`,
    [oldGrnId],
  );
  await c.end();

  await runMigrations(url); // apply 0004 + 0005
});

after(async () => {
  await stop?.();
});

async function one(sql: string, params: unknown[] = []) {
  const c = new pg.Client(url);
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

describe("migration of existing GRNs", () => {
  it("keeps the same Net Amount and sets Invoice Value = Net Amount", async () => {
    const [h] = await one("select net_payable, invoice_value from grn_header where id = $1", [oldGrnId]);
    assert.equal(h.net_payable, OLD_NET);
    assert.equal(h.invoice_value, OLD_NET);
  });

  it("moves the old GST total (items + freight GST) into gst_amount, mode = AMOUNT", async () => {
    const [h] = await one("select gst_mode, gst_input, gst_amount, cgst_amount, sgst_amount, igst_amount from grn_header where id = $1", [oldGrnId]);
    assert.equal(h.gst_mode, "AMOUNT");
    assert.equal(h.gst_amount, "1182.30");
    assert.equal(h.gst_input, "1182.30");
    assert.deepEqual([h.cgst_amount, h.sgst_amount, h.igst_amount], ["0.00", "0.00", "1182.30"]);
  });

  it("charges lose their GST columns but keep amounts; other charges get a description", async () => {
    const rows = await one("select charge_type, description, amount from grn_charges where grn_id = $1 order by id", [oldGrnId]);
    assert.deepEqual(rows, [
      { charge_type: "FREIGHT", description: null, amount: "500.00" },
      { charge_type: "OTHER", description: "Other charges", amount: "75.50" },
    ]);
    const cols = await one("select column_name from information_schema.columns where table_name = 'grn_charges' and column_name like 'gst%'");
    assert.equal(cols.length, 0);
  });

  it("old line-level GST stays readable (columns now nullable)", async () => {
    const rows = await one("select gst_amount, is_nullable from grn_lines, information_schema.columns c where grn_id = $1 and c.table_name = 'grn_lines' and c.column_name = 'gst_amount' order by line_no", [oldGrnId]);
    assert.deepEqual(rows.map((r) => r.gst_amount), ["600.00", "492.30"]);
    assert.equal(rows[0].is_nullable, "YES");
  });

  it("re-calculating the old GRN from its stored values gives the same Net Amount (opens and prints the same)", async () => {
    // Same data the entry screen and the A4 print use: header + lines + charges.
    const { calcGrn } = await import("../src/lib/grn-calc");
    const { toPaise } = await import("../src/lib/money");
    const [h] = await one("select * from grn_header where id = $1", [oldGrnId]);
    const lines = await one("select qty, purchase_rate from grn_lines where grn_id = $1 order by line_no", [oldGrnId]);
    const charges = await one("select charge_type, description, amount from grn_charges where grn_id = $1 order by sort_order, id", [oldGrnId]);
    const r = calcGrn({
      lines: lines.map((l) => ({ qty: l.qty, ratePaise: toPaise(l.purchase_rate) })),
      taxType: h.tax_type,
      discountType: h.discount_type,
      discountValue: h.discount_value,
      gstMode: h.gst_mode,
      gstValue: h.gst_input,
      transport: charges.filter((c) => c.charge_type === "FREIGHT").reduce((a, c) => a + toPaise(c.amount), 0),
      others: charges.filter((c) => c.charge_type === "OTHER").map((c) => ({ description: c.description, amount: toPaise(c.amount) })),
      roundOffManual: h.round_off_manual,
      roundOffPaise: toPaise(h.round_off),
    });
    assert.equal(r.net, toPaise(OLD_NET));
    assert.equal(r.taxable, toPaise(h.taxable_value));
    assert.equal(r.gst, toPaise(h.gst_amount));
  });
});
