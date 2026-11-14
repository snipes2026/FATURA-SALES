/**
 * Barcodes: every GRN line gets its own new barcode — never reused, not even
 * for an identical line or the same item on a later GRN.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import pg from "pg";
import { runMigrations, seedBasics, startTestDb } from "./helpers/test-db";

let stop: () => Promise<void>;
let url: string;
let ids: Awaited<ReturnType<typeof seedBasics>>;
let app: {
  db: typeof import("../src/db").db;
  pool: typeof import("../src/db").pool;
  persistDraft: typeof import("../src/app/(app)/grn/_lib/persist-draft").persistDraft;
  assignBarcodes: typeof import("../src/app/(app)/grn/_lib/barcodes").assignBarcodes;
  saveFinalGrn: typeof import("../src/app/(app)/grn/_lib/save-final").saveFinalGrn;
  grnDraftSchema: typeof import("../src/lib/validation/grn").grnDraftSchema;
  emptySummary: typeof import("../src/lib/validation/grn").emptySummary;
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
    persistDraft: (await import("../src/app/(app)/grn/_lib/persist-draft")).persistDraft,
    assignBarcodes: (await import("../src/app/(app)/grn/_lib/barcodes")).assignBarcodes,
    saveFinalGrn: (await import("../src/app/(app)/grn/_lib/save-final")).saveFinalGrn,
    grnDraftSchema: (await import("../src/lib/validation/grn")).grnDraftSchema,
    emptySummary: (await import("../src/lib/validation/grn")).emptySummary,
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

const line = (uid: string, qty = "3") => ({
  uid,
  departmentId: String(ids.deptId),
  itemName: "Plain Tee",
  cat1: "",
  cat2: "",
  cat3: "",
  cat4: "",
  qty,
  purchaseRate: "100",
  wsp: "",
  rsp: "",
  mrp: "299",
  imagePath: null,
  priceWarningOverridden: false,
});

let seq = 0;
function draft(lines: ReturnType<typeof line>[], invoiceValue = "1") {
  seq += 1;
  return app.grnDraftSchema("2099-12-31").parse({
    header: {
      grnDate: "2026-11-14",
      locationId: String(ids.locationId),
      supplierId: String(ids.supIntra),
      invoiceNo: `BC-${seq}`,
      invoiceDate: "2026-11-14",
      invoiceValue,
      transportId: "",
      lrNo: "",
      transportDate: "",
    },
    lines,
    summary: app.emptySummary(),
  });
}

async function rows(sql: string, params: unknown[] = []) {
  const c = new pg.Client(url);
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

describe("barcodes — one new barcode per GRN line, never reused", () => {
  let firstGrnBarcodes: string[] = [];

  it("two identical lines in the same GRN get two different barcodes", async () => {
    const saved = await app.db.transaction(async (tx) => {
      const s = await app.persistDraft(tx, draft([line("a"), line("b")]), user());
      const r = await app.assignBarcodes(tx, s.id, ids.userId);
      return { s, r };
    });
    assert.equal(saved.r.assigned, 2);
    const ls = await rows("select line_no, barcode, product_id from grn_lines where grn_id = $1 order by line_no", [saved.s.id]);
    firstGrnBarcodes = ls.map((l) => l.barcode);
    assert.deepEqual(firstGrnBarcodes, ["T000001", "T000002"]);
    assert.notEqual(ls[0].product_id, ls[1].product_id, "each line has its own item record");
  });

  it("the same item on a later GRN gets a new barcode (and the counter moves by exactly one per line)", async () => {
    // Saved for real this time: 3 lines × 3 × ₹100 = ₹900
    const r = await app.db.transaction((tx) => app.saveFinalGrn(tx, draft([line("x"), line("y"), line("z")], "900"), user(), false));
    const ls = await rows("select barcode from grn_lines where grn_id = $1 order by line_no", [r.id]);
    assert.deepEqual(
      ls.map((l) => l.barcode),
      ["T000003", "T000004", "T000005"],
    );
    for (const b of ls.map((l) => l.barcode)) assert.ok(!firstGrnBarcodes.includes(b));
    const [counter] = await rows("select last_value from counters where name = 'BARCODE'");
    assert.equal(counter.last_value, 5);
    const [{ n }] = await rows("select count(*)::int n from products");
    assert.equal(n, 5, "one item record per line");
  });

  it("no barcode appears on more than one line", async () => {
    const dup = await rows("select barcode, count(*)::int n from grn_lines where barcode is not null group by barcode having count(*) > 1");
    assert.deepEqual(dup, []);
  });

  it("the database itself rejects putting one barcode on a second line", async () => {
    const [a, b] = await rows("select id, product_id from grn_lines where barcode is not null order by id limit 2");
    await assert.rejects(rows("update grn_lines set product_id = $1 where id = $2", [a.product_id, b.id]), /grn_lines_product_uq/);
  });

  it("a failed save uses up no barcode numbers", async () => {
    const before = (await rows("select last_value from counters where name = 'BARCODE'"))[0].last_value;
    // Invoice value doesn't match → Save GRN fails after barcodes were assigned inside the transaction
    await assert.rejects(app.db.transaction((tx) => app.saveFinalGrn(tx, draft([line("p")], "1"), user(), false)));
    const afterVal = (await rows("select last_value from counters where name = 'BARCODE'"))[0].last_value;
    assert.equal(afterVal, before);
  });
});
