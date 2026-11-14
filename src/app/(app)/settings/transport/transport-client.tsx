"use client";

import { useCallback, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { ActiveChip } from "@/components/ui/chip";
import { DataTable } from "@/components/ui/data-table";
import { Drawer } from "@/components/ui/drawer";
import { FormError, FormGrid, Switch, TextField } from "@/components/ui/fields";
import { transportSchema } from "@/lib/validation/masters";
import { saveTransport } from "./actions";

export type TransportRow = { id: number; name: string; gstin: string; phone: string; isActive: boolean };
type Values = Omit<TransportRow, "id"> & { id?: number };
const EMPTY: Values = { name: "", gstin: "", phone: "", isActive: true };

export function TransportClient({ rows }: { rows: TransportRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TransportRow | null>(null);
  const f = useForm<Values>(EMPTY);
  const close = useCallback(() => setOpen(false), []);

  const openForm = (r: TransportRow | null) => {
    setEditing(r);
    f.reset(r ?? EMPTY);
    setOpen(true);
  };

  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.name} ${r.gstin} ${r.phone}`}
        onRowClick={openForm}
        rowClassName={(r) => (r.isActive ? undefined : "text-muted")}
        toolbar={
          <Button onClick={() => openForm(null)}>
            <Plus /> Add Transporter
          </Button>
        }
        columns={[
          { key: "name", header: "Transporter", cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: "gstin", header: "GSTIN", cell: (r) => <span className="font-mono text-xs">{r.gstin || "—"}</span> },
          { key: "phone", header: "Phone", cell: (r) => r.phone || "—" },
          { key: "status", header: "Status", cell: (r) => <ActiveChip active={r.isActive} /> },
        ]}
        rowActions={(r) => (
          <Button variant="ghost" size="sm" onClick={() => openForm(r)} aria-label={`Edit ${r.name}`}>
            <Pencil />
          </Button>
        )}
        empty="No transporters yet."
      />
      <Drawer
        open={open}
        title={editing ? `Edit transporter — ${editing.name}` : "Add transporter"}
        onClose={close}
        pending={f.pending}
        onSubmit={() => f.submit(transportSchema, saveTransport, () => setOpen(false))}
        width={420}
      >
        <FormError>{f.errors._form}</FormError>
        <FormGrid cols={1}>
          <TextField label="Transporter name" name="name" required value={f.values.name} onChange={(e) => f.set("name", e.target.value)} error={f.errors.name} />
          <TextField
            label="GSTIN"
            name="gstin"
            maxLength={15}
            inputClassName="uppercase"
            value={f.values.gstin}
            onChange={(e) => f.set("gstin", e.target.value.toUpperCase())}
            error={f.errors.gstin}
          />
          <TextField label="Phone" name="phone" inputMode="tel" value={f.values.phone} onChange={(e) => f.set("phone", e.target.value)} error={f.errors.phone} />
          <Switch checked={f.values.isActive} onChange={(v) => f.set("isActive", v)} label="Active" />
        </FormGrid>
      </Drawer>
    </>
  );
}
