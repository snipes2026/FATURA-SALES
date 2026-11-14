"use client";

import { useCallback, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { ActiveChip, Chip } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { FormError, FormGrid, SelectField, Switch, TextAreaField, TextField } from "@/components/ui/fields";
import { GST_STATES, STATE_OPTIONS, stateFromGstin, stateName } from "@/lib/india";
import { locationSchema } from "@/lib/validation/masters";
import { saveLocation } from "./actions";

export type LocationRow = {
  id: number;
  name: string;
  type: "STORE" | "GODOWN";
  gstin: string;
  stateCode: string;
  address: string;
  isActive: boolean;
};
type Values = Omit<LocationRow, "id" | "type"> & { id?: number; type: "STORE" | "GODOWN" | "" };
const EMPTY: Values = { name: "", type: "STORE", gstin: "", stateCode: "", address: "", isActive: true };

export function LocationsClient({ rows }: { rows: LocationRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  const f = useForm<Values>(EMPTY);
  const close = useCallback(() => setOpen(false), []);

  const openForm = (r: LocationRow | null) => {
    setEditing(r);
    f.reset(r ?? EMPTY);
    setOpen(true);
  };

  const onGstin = (v: string) => {
    const g = v.toUpperCase().replace(/\s/g, "");
    f.set("gstin", g);
    const st = stateFromGstin(g);
    if (st && GST_STATES[st]) f.set("stateCode", st);
  };

  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.name} ${r.gstin} ${stateName(r.stateCode)} ${r.type}`}
        onRowClick={openForm}
        rowClassName={(r) => (r.isActive ? undefined : "text-muted")}
        toolbar={
          <Button onClick={() => openForm(null)}>
            <Plus /> Add Location
          </Button>
        }
        columns={[
          { key: "name", header: "Location", cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: "type", header: "Type", cell: (r) => <Chip tone={r.type === "STORE" ? "primary" : "neutral"}>{r.type === "STORE" ? "Store" : "Godown"}</Chip> },
          { key: "gstin", header: "GSTIN", cell: (r) => <span className="font-mono text-xs">{r.gstin || "—"}</span> },
          { key: "state", header: "State", cell: (r) => stateName(r.stateCode) },
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
        title={editing ? `Edit location — ${editing.name}` : "Add location"}
        onClose={close}
        pending={f.pending}
        onSubmit={() => f.submit(locationSchema, saveLocation, () => setOpen(false))}
      >
        <FormError>{f.errors._form}</FormError>
        <FormGrid>
          <TextField label="Location name" name="name" required value={f.values.name} onChange={(e) => f.set("name", e.target.value)} error={f.errors.name} />
          <SelectField
            label="Type"
            name="type"
            required
            options={[
              { value: "STORE", label: "Store" },
              { value: "GODOWN", label: "Godown" },
            ]}
            value={f.values.type}
            onChange={(e) => f.set("type", e.target.value as Values["type"])}
            error={f.errors.type}
          />
          <TextField label="GSTIN" name="gstin" maxLength={15} inputClassName="uppercase" value={f.values.gstin} onChange={(e) => onGstin(e.target.value)} error={f.errors.gstin} />
          <SelectField
            label="State"
            name="stateCode"
            required
            placeholder="Select state"
            options={STATE_OPTIONS}
            value={f.values.stateCode}
            onChange={(e) => f.set("stateCode", e.target.value)}
            error={f.errors.stateCode}
            hint="Decides CGST+SGST vs IGST on GRNs"
          />
          <TextAreaField className="sm:col-span-2" label="Address" name="address" value={f.values.address} onChange={(e) => f.set("address", e.target.value)} error={f.errors.address} />
          <div className="sm:col-span-2">
            <Switch checked={f.values.isActive} onChange={(v) => f.set("isActive", v)} label="Active" />
            {f.errors.isActive && <p className="mt-1 text-xs text-danger">{f.errors.isActive}</p>}
          </div>
        </FormGrid>
        {!editing && <p className="mt-4 text-xs text-muted">All admins get access to a new location automatically. Give other users access under Users.</p>}
      </Drawer>
    </>
  );
}
