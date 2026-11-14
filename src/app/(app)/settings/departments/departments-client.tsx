"use client";

import { useCallback, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { ActiveChip, Chip } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { FormError, FormGrid, SelectField, Switch, TextField } from "@/components/ui/fields";
import { formatINR, GST_RATES } from "@/lib/india";
import { departmentSchema } from "@/lib/validation/masters";
import { saveDepartment } from "./actions";

export type DepartmentRow = {
  id: number;
  name: string;
  hsnCode: string;
  gstRate: string;
  slabEnabled: boolean;
  slabThreshold: string;
  slabRateAbove: string;
  isActive: boolean;
};
type Values = Omit<DepartmentRow, "id"> & { id?: number };
const EMPTY: Values = { name: "", hsnCode: "", gstRate: "", slabEnabled: false, slabThreshold: "", slabRateAbove: "", isActive: true };
const RATE_OPTIONS = GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }));

export function DepartmentsClient({ rows }: { rows: DepartmentRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const f = useForm<Values>(EMPTY);
  const close = useCallback(() => setOpen(false), []);

  const openForm = (r: DepartmentRow | null) => {
    setEditing(r);
    f.reset(r ?? EMPTY);
    setOpen(true);
  };

  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.name} ${r.hsnCode}`}
        onRowClick={openForm}
        rowClassName={(r) => (r.isActive ? undefined : "text-muted")}
        toolbar={
          <Button onClick={() => openForm(null)}>
            <Plus /> Add Department
          </Button>
        }
        columns={[
          { key: "name", header: "Department", cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: "hsn", header: "HSN", cell: (r) => <span className="font-mono text-xs">{r.hsnCode}</span> },
          { key: "gst", header: "GST %", align: "right", cell: (r) => `${r.gstRate}%` },
          {
            key: "slab",
            header: "Price-based slab",
            cell: (r) =>
              r.slabEnabled ? (
                <Chip tone="warning">
                  {r.gstRate}% up to {formatINR(r.slabThreshold)} · {r.slabRateAbove}% above
                </Chip>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
          { key: "status", header: "Status", cell: (r) => <ActiveChip active={r.isActive} /> },
        ]}
        rowActions={(r) => (
          <Button variant="ghost" size="sm" onClick={() => openForm(r)} aria-label={`Edit ${r.name}`}>
            <Pencil />
          </Button>
        )}
      />
      <Drawer
        open={open}
        title={editing ? `Edit department — ${editing.name}` : "Add department"}
        onClose={close}
        pending={f.pending}
        onSubmit={() => f.submit(departmentSchema, saveDepartment, () => setOpen(false))}
      >
        <FormError>{f.errors._form}</FormError>
        <FormGrid>
          <TextField className="sm:col-span-2" label="Department name" name="name" required value={f.values.name} onChange={(e) => f.set("name", e.target.value)} error={f.errors.name} />
          <TextField
            label="HSN code"
            name="hsnCode"
            required
            inputMode="numeric"
            maxLength={8}
            value={f.values.hsnCode}
            onChange={(e) => f.set("hsnCode", e.target.value.replace(/\D/g, ""))}
            error={f.errors.hsnCode}
            hint="4, 6 or 8 digits"
          />
          <SelectField
            label={f.values.slabEnabled ? "GST rate (up to limit)" : "GST rate"}
            name="gstRate"
            required
            placeholder="Select"
            options={RATE_OPTIONS}
            value={f.values.gstRate}
            onChange={(e) => f.set("gstRate", e.target.value)}
            error={f.errors.gstRate}
          />
          <div className="rounded-md border border-border bg-slate-50 p-3 sm:col-span-2">
            <Switch
              checked={f.values.slabEnabled}
              onChange={(v) => f.set("slabEnabled", v)}
              label="Price-based GST slab"
              description="Use a different rate when the per-unit rate is above a limit (e.g. apparel, footwear)."
            />
            {f.values.slabEnabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Per-unit limit (₹)"
                  name="slabThreshold"
                  required
                  inputMode="decimal"
                  inputClassName="text-right"
                  value={f.values.slabThreshold}
                  onChange={(e) => f.set("slabThreshold", e.target.value)}
                  error={f.errors.slabThreshold}
                />
                <SelectField
                  label="Rate above limit"
                  name="slabRateAbove"
                  required
                  placeholder="Select"
                  options={RATE_OPTIONS}
                  value={f.values.slabRateAbove}
                  onChange={(e) => f.set("slabRateAbove", e.target.value)}
                  error={f.errors.slabRateAbove}
                />
                {f.values.gstRate && f.values.slabThreshold && f.values.slabRateAbove && (
                  <p className="text-xs text-muted sm:col-span-2">
                    {f.values.gstRate}% when rate ≤ {formatINR(f.values.slabThreshold)}, otherwise {f.values.slabRateAbove}%.
                  </p>
                )}
              </div>
            )}
          </div>
          <Switch checked={f.values.isActive} onChange={(v) => f.set("isActive", v)} label="Active" />
        </FormGrid>
      </Drawer>
    </>
  );
}
