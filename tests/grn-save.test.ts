/**
 * Save GRN rules on the server (the same transaction body the "Save GRN"
 * action runs): Invoice Value must equal Net Payable; Save as Draft doesn't care.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { runMigrations, seedBasics, startTestDb } from "./helpers/test-db";

let stop: () => Promise<void>;
let url: string;
let ids: Awaited<ReturnType<typeof seedBasics>>;
// App modules are imported after DATABASE_URL is set (the pool is created on import).
let app: {
  db: typeof import("../src/db").db;
  pool: typeof import("../src/db").pool;
  saveFinalGrn: typeof import("../src/app/(app)/grn/_lib/save-final").saveFinalGrn;
  persistDraft: typeof import("../src/app/(app)/grn/_lib/persist-draft").persistDraft;
  grnDraftSchema: typeof import("../src/lib/validation/grn").grnDraftSchema;
  emptySummary: typeof import("../src/lib/validation/grn").emptySummary;
  ActionError: typeof import("../src/lib/server-action").ActionError;
};

before(async () => {
  const t = await startTestDb();
  stop = t.stop;
  url = t.url;
  await runMigrations(url);
  ids = await seedBasics(url);
  process.env.DATABASE_URL = url;
  process.env.DB_POOL_MAX = "1";
  const dbm = await import("../src/db");
  app = {
    db: dbm.db,
    pool: dbm.pool,
    saveFinalGrn: (await import("../src/app/(app)/grn/_lib/save-final")).saveFinalGrn,
    persistDraft: (await import("../src/app/(app)/grn/_lib/persist-draft")).persistDraft,
    grnDraftSchema: (await import("../src/lib/validation/grn")).grnDraftSchema,
    emptySummary: (await import("../src/lib/validation/grn")).emptySummary,
    ActionError: (await import("../src/lib/server-action")).ActionError,
  };
});

after(async () => {
  await app?.pool.end();
  await stop?.();
});

const user = () => ({
  id: ids.userId,
  name: "Tester",
  username: "tester",
  role: "ADMIN",
  roleName: "Admin",
  locations: [{ id: ids.locationId, name: "Main Store", type: "STORE" as const, stateCode: "27" }],
  currentLocationId: ids.locationId,
});

let invoiceSeq = 0;
/** 10 × ₹100 + 5% GST + ₹50 transport = ₹1,100.00 */
function draft(invoiceValue: string, supplierId = ids.supIntra) {
  invoiceSeq += 1;
  return app.grnDraftSchema("2099-12-31").parse({
    header: {
      grnDate: "2026-11-14",
      locationId: String(ids.locationId),
      supplierId: String(supplierId),
      invoiceNo: `TEST-${invoiceSeq}`,
      invoiceDate: "2026-11-14",
      invoiceValue,
      transportId: "",
      lrNo: "",
      transportDate: "",
    },
    lines: [
      {
        uid: "l1",
        departmentId: String(ids.deptId),
        itemName: "Test Shirt",
        cat1: "",
        cat2: "",
        cat3: "",
        cat4: "",
        qty: "10",
        purchaseRate: "100",
        wsp: "",
        rsp: "",
        mrp: "199",
        imagePath: null,
        priceWarningOverridden: false,
      },
    ],
    summary: { ...app.emptySummary(), gstMode: "PERCENT", gstValue: "5", transport: "50" },
  });
}

async function scalar(sql: string, params: unknown[] = []) {
  const c = new pg.Client(url);
  await c.connect();
  try {
    return (await c.query(sql, params)).rows[0];
  } finally {
    await c.end();
  }
}

describe("Save GRN — Invoice Value must equal Net Payable", () => {
  it("rejects a mismatch with the exact message and saves nothing", async () => {
    const before = await scalar("select count(*)::int n from grn_header");
    await assert.rejects(
      app.db.transaction((tx) => app.saveFinalGrn(tx, draft("1000.00"), user(), false)),
      (err: unknown) => {
        assert.ok(err instanceof app.ActionError);
        assert.equal(err.code, "MISMATCH");
        assert.equal(err.field, "invoiceValue");
        assert.equal(
          err.message,
          "GRN total ₹1,100.00 does not match Invoice Value ₹1,000.00 (difference ₹100.00). Please check items, discount, GST, charges, or round-off.",
        );
        return true;
      },
    );
    const afterCount = await scalar("select count(*)::int n from grn_header");
    assert.equal(afterCount.n, before.n, "the whole transaction rolled back");
    const counter = await scalar("select count(*)::int n from counters where name = 'GRN'");
    assert.equal(counter.n, 0, "no GRN number was used up");
  });

  it("saves when the totals match exactly (to 2 decimals)", async () => {
    const r = await app.db.transaction((tx) => app.saveFinalGrn(tx, draft("1100.00"), user(), false));
    assert.match(r.grnNo, /^GRN\/26-27\/0001$/);
    const h = await scalar("select status, net_payable, invoice_value, gst_amount, cgst_amount, sgst_amount, igst_amount, charges_amount from grn_header where id = $1", [r.id]);
    assert.equal(h.status, "SAVED");
    assert.equal(h.net_payable, "1100.00");
    assert.equal(h.invoice_value, "1100.00");
    assert.deepEqual([h.gst_amount, h.cgst_amount, h.sgst_amount, h.igst_amount], ["50.00", "25.00", "25.00", "0.00"]);
    assert.equal(h.charges_amount, "50.00");
    const line = await scalar("select gst_rate, gst_amount from grn_lines where grn_id = $1", [r.id]);
    assert.deepEqual([line.gst_rate, line.gst_amount], [null, null], "no line-level GST is written");
    const stock = await scalar("select sum(qty_in)::int q from stock_ledger where ref_doc_id = $1", [r.id]);
    assert.equal(stock.q, 10);
  });

  it("inter-state supplier stores the GST as IGST", async () => {
    const r = await app.db.transaction((tx) => app.saveFinalGrn(tx, draft("1100.00", ids.supInter), user(), false));
    const h = await scalar("select cgst_amount, sgst_amount, igst_amount from grn_header where id = $1", [r.id]);
    assert.deepEqual([h.cgst_amount, h.sgst_amount, h.igst_amount], ["0.00", "0.00", "50.00"]);
  });

  it("Save as Draft is allowed with a mismatch", async () => {
    const r = await app.db.transaction((tx) => app.persistDraft(tx, draft("1.00"), user()));
    const h = await scalar("select status, net_payable, invoice_value from grn_header where id = $1", [r.id]);
    assert.deepEqual([h.status, h.net_payable, h.invoice_value], ["DRAFT", "1100.00", "1.00"]);
  });

  it("rejects a GRN whose net payable is not more than 0", async () => {
    const input = draft("1100.00");
    input.summary.otherCharges = [{ uid: "x", description: "Credit note", amount: "-1100" }];
    await assert.rejects(app.db.transaction((tx) => app.saveFinalGrn(tx, input, user(), false)), /Net payable must be more than ₹0/);
  });
});
