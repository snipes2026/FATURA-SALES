"use client";

import { useEffect } from "react";
import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { FormError, FormGrid, SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/modal";
import { GST_STATES, STATE_OPTIONS, stateFromGstin } from "@/lib/india";
import { supplierSchema, type SupplierInput } from "@/lib/validation/masters";
import { quickCreateSupplier } from "../actions";

type Values = Omit<SupplierInput, "id"> & Record<string, unknown>;
const EMPTY: Values = {
  name: "",
  gstin: "",
  stateCode: "",
  address: "",
  contactPerson: "",
  phone: "",
  email: "",
  pan: "",
  openingBalance: "0",
  isActive: true,
};

export type NewSupplier = { id: number; name: string; gstin: string; stateCode: string };

/** "+ Add" supplier from the GRN screen (minimal fields; full details in Settings). */
export function QuickSupplierModal({
  open,
  initialName,
  onClose,
  onCreated,
}: {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onCreated: (s: NewSupplier) => void;
}) {
  const f = useForm<Values>(EMPTY);
  const { reset } = f;
  useEffect(() => {
    if (open) reset({ ...EMPTY, name: initialName });
  }, [open, initialName, reset]);

  const onGstin = (v: string) => {
    const g = v.toUpperCase().replace(/\s/g, "");
    f.set("gstin", g);
    const st = stateFromGstin(g);
    if (st && GST_STATES[st]) f.set("stateCode", st);
    if (g.length >= 12) f.set("pan", g.slice(2, 12));
  };

  const submit = () => f.submit(supplierSchema, quickCreateSupplier, (r) => r.data && onCreated(r.data));

  return (
    <Modal
      open={open}
      title="Add supplier"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={f.pending}>
            {f.pending ? "Adding…" : "Add supplier"}
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError>{f.errors._form}</FormError>
        <FormGrid>
          <TextField className="sm:col-span-2" label="Supplier name" name="qs-name" required value={f.values.name} onChange={(e) => f.set("name", e.target.value)} error={f.errors.name} />
          <TextField label="GSTIN" name="qs-gstin" maxLength={15} inputClassName="uppercase" value={f.values.gstin} onChange={(e) => onGstin(e.target.value)} error={f.errors.gstin} />
          <SelectField
            label="State"
            name="qs-state"
            required
            placeholder="Select state"
            options={STATE_OPTIONS}
            value={f.values.stateCode}
            onChange={(e) => f.set("stateCode", e.target.value)}
            error={f.errors.stateCode}
          />
          <TextField label="Contact person" name="qs-contact" value={f.values.contactPerson} onChange={(e) => f.set("contactPerson", e.target.value)} error={f.errors.contactPerson} />
          <TextField label="Phone" name="qs-phone" inputMode="tel" value={f.values.phone} onChange={(e) => f.set("phone", e.target.value)} error={f.errors.phone} />
        </FormGrid>
        {f.errors.pan && <p className="mt-2 text-xs text-danger">PAN: {f.errors.pan}</p>}
        <p className="mt-3 text-xs text-muted">Address, PAN and opening balance can be completed later in Settings → Suppliers.</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
