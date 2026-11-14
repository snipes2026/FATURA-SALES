import type { Metadata } from "next";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { formatAmount } from "@/lib/india";
import { requirePermission } from "@/lib/session";
import { LABEL_FIELDS } from "@/lib/validation/masters";
import { LabelSheet, type Label } from "./label-sheet";

export const metadata: Metadata = { title: "Labels" };

const MAX_LABELS = 5000;

/**
 * /print/grn/:id/labels?layout=a4|thermal&c=lineId:count,lineId:count[&auto=1]
 * Label data always comes from the database, never from the URL.
 */
export default async function LabelsPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ layout?: string; c?: string; auto?: string }>;
}) {
  const user = await requirePermission("grn.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id) || id <= 0) notFound();

  const [h] = await db.select().from(schema.grnHeader).where(eq(schema.grnHeader.id, id));
  if (!h || !user.locations.some((l) => l.id === h.locationId)) notFound();

  // Requested counts: "12:10,13:5", or "all" = every barcoded line × its quantity
  const counts = new Map<number, number>();
  if (sp.c === "all") {
    const all = await db
      .select({ id: schema.grnLines.id, qty: schema.grnLines.qty })
      .from(schema.grnLines)
      .where(and(eq(schema.grnLines.grnId, id), isNotNull(schema.grnLines.barcode)));
    for (const l of all) counts.set(l.id, Math.min(l.qty, MAX_LABELS));
  }
  for (const part of (sp.c === "all" ? "" : (sp.c ?? "")).split(",")) {
    const [lid, n] = part.split(":").map(Number);
    if (Number.isInteger(lid) && Number.isInteger(n) && n > 0) counts.set(lid, Math.min(n, MAX_LABELS));
  }

  const [lines, settingsRows, companyRows, catConfig] = await Promise.all([
    counts.size
      ? db
          .select()
          .from(schema.grnLines)
          .where(and(eq(schema.grnLines.grnId, id), inArray(schema.grnLines.id, [...counts.keys()]), isNotNull(schema.grnLines.barcode)))
          .orderBy(schema.grnLines.lineNo)
      : Promise.resolve([]),
    db.select().from(schema.barcodeSettings).where(eq(schema.barcodeSettings.id, 1)),
    db.select({ name: schema.companyProfile.name }).from(schema.companyProfile).where(eq(schema.companyProfile.id, 1)),
    db.select().from(schema.categoryConfig),
  ]);
  const settings = settingsRows[0];
  const valueIds = [...new Set(lines.flatMap((l) => [l.cat1ValueId, l.cat2ValueId, l.cat3ValueId, l.cat4ValueId]).filter((v): v is number => v != null))];
  const values = valueIds.length
    ? await db.select({ id: schema.categoryValues.id, value: schema.categoryValues.value }).from(schema.categoryValues).where(inArray(schema.categoryValues.id, valueIds))
    : [];
  const valueName = new Map(values.map((v) => [v.id, v.value]));
  // Print the product master's name (one spelling per barcode), not each line's typing.
  const productIds = [...new Set(lines.map((l) => l.productId).filter((v): v is number => v != null))];
  const productNames = new Map(
    (productIds.length
      ? await db.select({ id: schema.products.id, itemName: schema.products.itemName }).from(schema.products).where(inArray(schema.products.id, productIds))
      : []
    ).map((p) => [p.id, p.itemName]),
  );
  const hidden = new Set(catConfig.filter((c) => c.mode === "HIDDEN").map((c) => c.slot));

  const fields = new Set(((settings?.labelFields as string[] | undefined) ?? ["itemName", "mrp", "barcodeText"]).filter((k) => LABEL_FIELDS.some((f) => f.key === k)));

  const labels: Label[] = [];
  for (const l of lines) {
    const cats = ([1, 2, 3, 4] as const)
      .filter((slot) => fields.has(`cat${slot}`) && !hidden.has(slot))
      .map((slot) => valueName.get(l[`cat${slot}ValueId`] as number))
      .filter((v): v is string => !!v);
    const label: Label = {
      barcode: l.barcode!,
      itemName: fields.has("itemName") ? ((l.productId != null ? productNames.get(l.productId) : undefined) ?? l.itemName) : null,
      cats: cats.join(" · ") || null,
      mrp: fields.has("mrp") ? `MRP ₹${formatAmount(l.mrp)}` : null,
      rsp: fields.has("rsp") && l.rsp ? `RSP ₹${formatAmount(l.rsp)}` : null,
      showText: fields.has("barcodeText"),
    };
    for (let i = 0; i < (counts.get(l.id) ?? 0) && labels.length < MAX_LABELS; i++) labels.push(label);
  }

  const [w, hgt] = (settings?.labelSize ?? "50x25").split("x").map(Number);
  return (
    <LabelSheet
      labels={labels}
      layout={sp.layout === "a4" ? "a4" : "thermal"}
      widthMm={w}
      heightMm={hgt}
      perRow={Math.max(1, Math.min(6, settings?.labelsPerRow ?? 1))}
      company={companyRows[0]?.name ?? ""}
      grnLabel={h.grnNo ?? `Draft #${h.id}`}
      autoPrint={sp.auto === "1"}
    />
  );
}
