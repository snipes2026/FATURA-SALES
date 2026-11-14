"use client";

import { useCallback, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { ActiveChip } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { FormError, FormGrid, SelectField, Switch, TextAreaField, TextField } from "@/components/ui/fields";
import { formatAmount, GST_STATES, STATE_OPTIONS, stateFromGstin, stateName } from "@/lib/india";
import { supplierSchema } from "@/lib/validation/masters";
import { saveSupplier } from "./actions";

export type SupplierRow = {
  id: number;
  name: string;
  gstin: string;
  stateCode: string;
  address: string;
  contactPerson: string;
  phone: string;
  email: string;
  pan: string;
  openingBalance: string;
  isActive: boolean;
  grnCount: number;
};

type Values = Omit<SupplierRow, "id" | "grnCount"> & { id?: number };

const EMPTY: Values = {
  name: "",
  gstin: "",
  stateCode: "",
  address: "",
  contactPerson: "",
  phone: "",
  email: "",
  pan: "",
  openingBalance: "0.00",
  isActive: true,
};

export function SuppliersClient({ rows }: { rows: SupplierRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const f = useForm<Values>(EMPTY);

  const openNew = () => {
    setEditing(null);
    f.reset(EMPTY);
    setOpen(true);
  };
  const openEdit = (r: SupplierRow) => {
    setEditing(r);
    const { grnCount: _g, ...values } = r;
    f.reset(values);
    setOpen(true);
  };
  const close = useCallback(() => setOpen(false), []);

  const onGstin = (v: string) => {
    const g = v.toUpperCase().replace(/\s/g, "");
    f.set("gstin", g);
    const st = stateFromGstin(g);
    if (st && GST_STATES[st]) f.set("stateCode", st);
    if (g.length >= 12 && !f.values.pan) f.set("pan", g.slice(2, 12));
  };

  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.name} ${r.gstin} ${r.phone} ${r.contactPerson} ${stateName(r.stateCode)}`}
        searchPlaceholder="Search name, GSTIN, phone…"
        onRowClick={openEdit}
        rowClassName={(r) => (r.isActive ? undefined : "text-muted")}
        toolbar={
          <Button onClick={openNew}>
            <Plus /> Add Supplier
          </Button>
        }
        columns={[
          { key: "name", header: "Supplier", cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: "gstin", header: "GSTIN", cell: (r) => <span className="font-mono text-xs">{r.gstin || "—"}</span> },
          { key: "state", header: "State", cell: (r) => stateName(r.stateCode) },
          { key: "contact", header: "Contact", cell: (r) => [r.contactPerson, r.phone].filter(Boolean).join(" · ") || "—" },
          { key: "ob", header: "Opening Bal. (₹)", align: "right", cell: (r) => formatAmount(r.openingBalance) },
          { key: "grns", header: "GRNs", align: "right", cell: (r) => r.grnCount },
          { key: "status", header: "Status", cell: (r) => <ActiveChip active={r.isActive} /> },
        ]}
        rowActions={(r) => (
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)} aria-label={`Edit ${r.name}`}>
            <Pencil />
          </Button>
        )}
        empty="No suppliers yet — add your first one."
      />

      <Drawer
        open={open}
        title={editing ? `Edit supplier — ${editing.name}` : "Add supplier"}
        onClose={close}
        pending={f.pending}
        onSubmit={() => f.submit(supplierSchema, saveSupplier, () => setOpen(false))}
      >
        <FormError>{f.errors._form}</FormError>
        <FormGrid>
          <TextField className="sm:col-span-2" label="Supplier name" name="name" required value={f.values.name} onChange={(e) => f.set("name", e.target.value)} error={f.errors.name} />
          <TextField
            label="GSTIN"
            name="gstin"
            maxLength={15}
            inputClassName="uppercase"
            value={f.values.gstin}
            onChange={(e) => onGstin(e.target.value)}
            error={f.errors.gstin}
            hint="State and PAN fill in automatically"
          />
          <SelectField
            label="State"
            name="stateCode"
            required
            placeholder="Select state"
            options={STATE_OPTIONS}
            value={f.values.stateCode}
            onChange={(e) => f.set("stateCode", e.target.value)}
            error={f.errors.stateCode}
          />
          <TextAreaField className="sm:col-span-2" label="Address" name="address" value={f.values.address} onChange={(e) => f.set("address", e.target.value)} error={f.errors.address} />
          <TextField label="Contact person" name="contactPerson" value={f.values.contactPerson} onChange={(e) => f.set("contactPerson", e.target.value)} error={f.errors.contactPerson} />
          <TextField label="Phone" name="phone" inputMode="tel" value={f.values.phone} onChange={(e) => f.set("phone", e.target.value)} error={f.errors.phone} />
          <TextField label="Email" name="email" type="email" value={f.values.email} onChange={(e) => f.set("email", e.target.value)} error={f.errors.email} />
          <TextField label="PAN" name="pan" maxLength={10} inputClassName="uppercase" value={f.values.pan} onChange={(e) => f.set("pan", e.target.value.toUpperCase())} error={f.errors.pan} />
          <TextField
            label="Opening balance (₹)"
            name="openingBalance"
            inputMode="decimal"
            inputClassName="text-right"
            value={f.values.openingBalance}
            onChange={(e) => f.set("openingBalance", e.target.value)}
            error={f.errors.openingBalance}
            hint="Amount payable to the supplier"
          />
          <div className="flex items-end pb-1">
            <Switch
              checked={f.values.isActive}
              onChange={(v) => f.set("isActive", v)}
              label="Active"
              description={editing && editing.grnCount > 0 ? "Used in GRNs — can be deactivated, not deleted" : undefined}
            />
          </div>
        </FormGrid>
      </Drawer>
    </>
  );
}
