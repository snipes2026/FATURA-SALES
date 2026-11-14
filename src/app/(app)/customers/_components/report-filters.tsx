"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CustomerPicker } from "@/app/(app)/sales/_components/customer-picker";
import { Button } from "@/components/ui/button";

const fieldCls = "h-9 rounded-md border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

/** Customer + (optional) date range; changes go into the URL so the page re-renders on the server. */
export function ReportFilters({
  basePath,
  customer,
  from,
  to,
  withDates,
  allowAll,
}: {
  basePath: string;
  customer: { id: number; label: string } | null;
  from?: string;
  to?: string;
  withDates: boolean;
  allowAll?: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? "");

  const go = (customerId: number | null, nf = f, nt = t) => {
    const q = new URLSearchParams();
    if (customerId) q.set("customer", String(customerId));
    if (withDates && nf) q.set("from", nf);
    if (withDates && nt) q.set("to", nt);
    router.push(`${basePath}?${q.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3">
      <div className="w-80">
        <span className="mb-1 block text-xs text-muted">Customer</span>
        <CustomerPicker selectedLabel={customer?.label ?? ""} onPick={(c) => go(c.id)} />
      </div>
      {withDates && (
        <>
          <label className="text-xs text-muted">
            From
            <input type="date" className={`${fieldCls} mt-1 block`} value={f} onChange={(e) => setF(e.target.value)} />
          </label>
          <label className="text-xs text-muted">
            To
            <input type="date" className={`${fieldCls} mt-1 block`} value={t} onChange={(e) => setT(e.target.value)} />
          </label>
          <Button variant="secondary" disabled={!customer || !f || !t || f > t} onClick={() => go(customer?.id ?? null)}>
            Show
          </Button>
        </>
      )}
      {allowAll && customer && (
        <Button variant="ghost" onClick={() => go(null)}>
          All customers
        </Button>
      )}
    </div>
  );
}
