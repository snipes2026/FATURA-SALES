import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { formatDate } from "@/lib/dates";
import { formatAmount } from "@/lib/india";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { GrnRowActions } from "./_components/grn-row-actions";

export const metadata: Metadata = { title: "GRN" };

const PAGE_SIZE = 50;
type SP = { from?: string; to?: string; supplier?: string; grnNo?: string; invoiceNo?: string; location?: string; status?: string; page?: string };

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export default async function GrnListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("grn.view");
  const sp = await searchParams;
  const locIds = user.locations.map((l) => l.id);
  const page = Math.max(1, Number(sp.page) || 1);

  // Filters (always limited to the user's locations)
  const where: SQL[] = [inArray(schema.grnHeader.locationId, locIds.length ? locIds : [-1])];
  if (isDate(sp.from)) where.push(gte(schema.grnHeader.grnDate, sp.from!));
  if (isDate(sp.to)) where.push(lte(schema.grnHeader.grnDate, sp.to!));
  if (Number(sp.supplier)) where.push(eq(schema.grnHeader.supplierId, Number(sp.supplier)));
  if (Number(sp.location) && locIds.includes(Number(sp.location))) where.push(eq(schema.grnHeader.locationId, Number(sp.location)));
  if (sp.status === "DRAFT" || sp.status === "SAVED" || sp.status === "CANCELLED") where.push(eq(schema.grnHeader.status, sp.status));
  if (sp.grnNo?.trim()) where.push(ilike(schema.grnHeader.grnNo, `%${escapeLike(sp.grnNo.trim())}%`));
  if (sp.invoiceNo?.trim()) where.push(ilike(schema.grnHeader.invoiceNo, `%${escapeLike(sp.invoiceNo.trim())}%`));
  const cond = and(...where);

  const [rows, [agg], suppliers] = await Promise.all([
    db
      .select({
        id: schema.grnHeader.id,
        version: schema.grnHeader.version,
        grnNo: schema.grnHeader.grnNo,
        grnDate: schema.grnHeader.grnDate,
        status: schema.grnHeader.status,
        invoiceNo: schema.grnHeader.invoiceNo,
        totalQty: schema.grnHeader.totalQty,
        netPayable: schema.grnHeader.netPayable,
        invoiceValue: schema.grnHeader.invoiceValue,
        supplier: schema.suppliers.name,
        location: schema.locations.name,
      })
      .from(schema.grnHeader)
      .innerJoin(schema.suppliers, eq(schema.suppliers.id, schema.grnHeader.supplierId))
      .innerJoin(schema.locations, eq(schema.locations.id, schema.grnHeader.locationId))
      .where(cond)
      .orderBy(desc(schema.grnHeader.grnDate), desc(schema.grnHeader.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({
        n: count(),
        savedQty: sql<number>`coalesce(sum(${schema.grnHeader.totalQty}) filter (where ${schema.grnHeader.status} = 'SAVED'), 0)::int`,
        savedNet: sql<string>`coalesce(sum(${schema.grnHeader.netPayable}) filter (where ${schema.grnHeader.status} = 'SAVED'), 0)::text`,
      })
      .from(schema.grnHeader)
      .where(cond),
    db.select({ id: schema.suppliers.id, name: schema.suppliers.name }).from(schema.suppliers).orderBy(asc(schema.suppliers.name)),
  ]);

  const pages = Math.max(1, Math.ceil(agg.n / PAGE_SIZE));
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    Object.entries({ ...sp, ...patch }).forEach(([k, v]) => v && p.set(k, String(v)));
    return `/grn?${p.toString()}`;
  };
  const filtered = Object.entries(sp).some(([k, v]) => k !== "page" && v);
  const ctl = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none";
  const lbl = "mb-1 block text-xs font-medium text-slate-600";

  return (
    <div className="space-y-4">
      {/* Filters: a plain GET form so the URL is shareable and Back works */}
      <Card>
        <form method="get" action="/grn" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-8">
          <div>
            <label className={lbl} htmlFor="f-from">From</label>
            <input id="f-from" name="from" type="date" defaultValue={sp.from} className={ctl} />
          </div>
          <div>
            <label className={lbl} htmlFor="f-to">To</label>
            <input id="f-to" name="to" type="date" defaultValue={sp.to} className={ctl} />
          </div>
          <div className="lg:col-span-2">
            <label className={lbl} htmlFor="f-supplier">Supplier</label>
            <select id="f-supplier" name="supplier" defaultValue={sp.supplier ?? ""} className={ctl}>
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="f-grnNo">GRN No.</label>
            <input id="f-grnNo" name="grnNo" defaultValue={sp.grnNo} placeholder="e.g. 0012" className={ctl} />
          </div>
          <div>
            <label className={lbl} htmlFor="f-invoiceNo">Invoice No.</label>
            <input id="f-invoiceNo" name="invoiceNo" defaultValue={sp.invoiceNo} className={ctl} />
          </div>
          <div>
            <label className={lbl} htmlFor="f-location">Location</label>
            <select id="f-location" name="location" defaultValue={sp.location ?? ""} className={ctl}>
              <option value="">All</option>
              {user.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? ""} className={ctl}>
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="SAVED">Saved</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-8">
            <Button type="submit" size="sm">
              <Search /> Apply
            </Button>
            {filtered && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/grn">Reset</Link>
              </Button>
            )}
            {can(user.role, "grn.create") && (
              <Button size="sm" className="ml-auto" asChild>
                <Link href="/grn/new">
                  <Plus /> New GRN
                </Link>
              </Button>
            )}
          </div>
        </form>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">GRN No</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Supplier</th>
                <th className="px-3 py-2 text-left font-medium">Invoice No</th>
                <th className="px-3 py-2 text-left font-medium">Location</th>
                <th className="px-3 py-2 text-right font-medium">Total Qty</th>
                <th className="px-3 py-2 text-right font-medium">Net Amount (₹)</th>
                <th className="px-3 py-2 text-right font-medium">Invoice Value (₹)</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="w-px px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-muted">
                    {filtered ? "No GRNs match these filters." : "No GRNs yet."}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className={`border-t border-border hover:bg-slate-50 ${r.status === "CANCELLED" ? "text-muted" : ""}`}>
                  <td className="px-3 py-2">
                    <Link href={`/grn/${r.id}`} className={`font-medium text-primary hover:underline ${r.status === "CANCELLED" ? "line-through" : ""}`}>
                      {r.grnNo ?? `Draft #${r.id}`}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(r.grnDate)}</td>
                  <td className="px-3 py-2">{r.supplier}</td>
                  <td className="px-3 py-2">{r.invoiceNo}</td>
                  <td className="px-3 py-2">{r.location}</td>
                  <td className="num px-3 py-2">{r.totalQty.toLocaleString("en-IN")}</td>
                  <td className="num px-3 py-2">{formatAmount(r.netPayable)}</td>
                  <td className="num px-3 py-2">{formatAmount(r.invoiceValue)}</td>
                  <td className="px-3 py-2">
                    <Chip tone={r.status === "SAVED" ? "success" : r.status === "CANCELLED" ? "danger" : "warning"}>
                      {r.status === "SAVED" ? "Saved" : r.status === "CANCELLED" ? "Cancelled" : "Draft"}
                    </Chip>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">
                    <GrnRowActions
                      grn={{ id: r.id, version: r.version, status: r.status, label: r.grnNo ?? `Draft #${r.id}`, totalQty: r.totalQty }}
                      canEditSaved={can(user.role, "grn.edit")}
                      canEditDraft={can(user.role, "grn.create")}
                      canDelete={can(user.role, "grn.delete")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2 text-sm text-muted">
          <span>
            {agg.n.toLocaleString("en-IN")} GRN{agg.n === 1 ? "" : "s"} · Saved: <strong className="text-ink">{agg.savedQty.toLocaleString("en-IN")}</strong> pcs, ₹
            <strong className="text-ink">{formatAmount(agg.savedNet)}</strong>
          </span>
          {pages > 1 && (
            <span className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" asChild disabled={page <= 1}>
                <Link href={qs({ page: String(page - 1) })} aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-40" : ""}>
                  <ChevronLeft /> Prev
                </Link>
              </Button>
              Page {page} of {pages}
              <Button variant="ghost" size="sm" asChild>
                <Link href={qs({ page: String(page + 1) })} aria-disabled={page >= pages} className={page >= pages ? "pointer-events-none opacity-40" : ""}>
                  Next <ChevronRight />
                </Link>
              </Button>
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
