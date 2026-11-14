"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomerPicker } from "./customer-picker";

const fieldCls = "h-9 rounded-md border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export type SalesFilterValues = { from: string; to: string; customer: { id: number; label: string } | null; q: string; status: "ALL" | "SAVED" | "CANCELLED" };

/** Sales List filters — kept in the URL. */
export function SalesFilters({ initial }: { initial: SalesFilterValues }) {
  const router = useRouter();
  const [v, setV] = useState(initial);

  const apply = (next = v) => {
    const q = new URLSearchParams({ from: next.from, to: next.to });
    if (next.customer) q.set("customer", String(next.customer.id));
    if (next.q.trim()) q.set("q", next.q.trim());
    if (next.status !== "ALL") q.set("status", next.status);
    router.push(`/sales?${q.toString()}`);
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <label className="text-xs text-muted">
        From
        <input type="date" className={`${fieldCls} mt-1 block`} value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} />
      </label>
      <label className="text-xs text-muted">
        To
        <input type="date" className={`${fieldCls} mt-1 block`} value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} />
      </label>
      <div className="w-64">
        <span className="mb-1 block text-xs text-muted">Customer</span>
        <CustomerPicker
          selectedLabel={v.customer?.label ?? ""}
          onPick={(c) => {
            const next = { ...v, customer: { id: c.id, label: c.name } };
            setV(next);
            apply(next);
          }}
        />
      </div>
      <label className="text-xs text-muted">
        Bill no.
        <input className={`${fieldCls} mt-1 block w-40 font-mono`} placeholder="e.g. 0012" value={v.q} onChange={(e) => setV({ ...v, q: e.target.value })} />
      </label>
      <label className="text-xs text-muted">
        Status
        <select className={`${fieldCls} mt-1 block`} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as SalesFilterValues["status"] })}>
          <option value="ALL">All</option>
          <option value="SAVED">Saved</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </label>
      <Button type="submit">Show</Button>
      {(v.customer || v.q || v.status !== "ALL") && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const next = { ...v, customer: null, q: "", status: "ALL" as const };
            setV(next);
            apply(next);
          }}
        >
          Clear filters
        </Button>
      )}
    </form>
  );
}
