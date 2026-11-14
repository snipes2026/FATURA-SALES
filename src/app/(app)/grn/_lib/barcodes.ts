import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { BARCODE_FY, COUNTER } from "@/lib/counters";
import { ActionError } from "@/lib/server-action";
import { formatBarcode } from "@/lib/validation/masters";

/**
 * Gives every line of the GRN that has no barcode yet its OWN new barcode,
 * inside the caller's transaction. A barcode is never reused: not for an
 * identical second line in the same GRN, and not for the same item on a later
 * GRN. Each line becomes its own item record (products row) with its own
 * purchase rate, MRP and photo.
 *
 *  1. Lock the barcode counter row (SELECT … FOR UPDATE), so two users
 *     generating at the same time can never get the same numbers.
 *  2. Take one block of numbers (start … start+n-1) for the n lines; the
 *     counter moves by exactly n. A rollback undoes the counter too, so there
 *     are no gaps.
 *  3. The database enforces "one barcode = one GRN line" (grn_lines_product_uq).
 */
export async function assignBarcodes(tx: Tx, grnId: number, userId: number) {
  const todo = await tx
    .select()
    .from(schema.grnLines)
    .where(and(eq(schema.grnLines.grnId, grnId), isNull(schema.grnLines.barcode)))
    .orderBy(asc(schema.grnLines.lineNo));
  if (todo.length === 0) return { assigned: 0, first: null as string | null, last: null as string | null };

  // 1. Counter lock (create the row on first use).
  await tx.insert(schema.counters).values({ name: COUNTER.BARCODE, fy: BARCODE_FY, lastValue: 0 }).onConflictDoNothing();
  const [counter] = await tx
    .select()
    .from(schema.counters)
    .where(and(eq(schema.counters.name, COUNTER.BARCODE), eq(schema.counters.fy, BARCODE_FY)))
    .for("update");
  const [settings] = await tx.select().from(schema.barcodeSettings).where(eq(schema.barcodeSettings.id, 1));
  if (!settings) throw new ActionError("Set up the barcode format in Settings → Barcode first");

  // 2. One block of new numbers, one per line.
  const start = Math.max(counter.lastValue + 1, settings.startNumber);
  const end = start + todo.length - 1;
  if (String(end).length > settings.digits)
    throw new ActionError(`Barcode numbers have run past ${settings.digits} digits — increase the digits in Settings → Barcode`);
  const codes = todo.map((_, i) => formatBarcode(settings, start + i));

  // A format change (prefix / digits / start) could produce a code that already exists — never allow that.
  const clash = await tx.select({ barcode: schema.products.barcode }).from(schema.products).where(inArray(schema.products.barcode, codes));
  if (clash.length) throw new ActionError(`Barcode ${clash[0].barcode} is already used — check Settings → Barcode (prefix / starting number)`);

  for (const [i, l] of todo.entries()) {
    const [p] = await tx
      .insert(schema.products)
      .values({
        departmentId: l.departmentId,
        itemName: l.itemName.trim(),
        cat1ValueId: l.cat1ValueId,
        cat2ValueId: l.cat2ValueId,
        cat3ValueId: l.cat3ValueId,
        cat4ValueId: l.cat4ValueId,
        barcode: codes[i],
        purchaseRate: l.purchaseRate,
        wsp: l.wsp,
        rsp: l.rsp,
        mrp: l.mrp,
        imagePath: l.imagePath,
        createdBy: userId,
      })
      .returning({ id: schema.products.id, barcode: schema.products.barcode });
    await tx.update(schema.grnLines).set({ productId: p.id, barcode: p.barcode }).where(eq(schema.grnLines.id, l.id));
  }

  await tx
    .update(schema.counters)
    .set({ lastValue: end })
    .where(and(eq(schema.counters.name, COUNTER.BARCODE), eq(schema.counters.fy, BARCODE_FY)));

  return { assigned: todo.length, first: codes[0], last: codes.at(-1)! };
}
