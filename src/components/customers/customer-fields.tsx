"use client";

import { FormGrid, SelectField, Switch, TextAreaField, TextField } from "@/components/ui/fields";
import { GST_STATES, STATE_OPTIONS, stateFromGstin } from "@/lib/india";
import type { CustomerInput } from "@/lib/validation/sales";

export type CustomerFormValues = Omit<CustomerInput, "id"> & { id?: number } & Record<string, unknown>;

export function emptyCustomer(companyStateCode: string, today: string): CustomerFormValues {
  return {
    name: "",
    address: "",
    gstin: "",
    stateCode: companyStateCode,
    phone: "",
    openingBalance: "0",
    openingType: "DR",
    openingDate: today,
    isActive: true,
  };
}

type Form = {
  values: CustomerFormValues;
  errors: Record<string, string>;
  set: <K extends keyof CustomerFormValues>(k: K, v: CustomerFormValues[K]) => void;
};

/**
 * Customer form fields, shared by Settings → Customers and the billing quick-add.
 * State follows the GSTIN; without one it defaults to the company's state.
 */
export function CustomerFields({
  f,
  idPrefix = "c",
  openingLocked,
  isWalkin,
  showActive = true,
  usedNote,
}: {
  f: Form;
  idPrefix?: string;
  openingLocked?: boolean;
  isWalkin?: boolean;
  showActive?: boolean;
  usedNote?: string;
}) {
  const onGstin = (v: string) => {
    const g = v.toUpperCase().replace(/\s/g, "");
    f.set("gstin", g);
    const st = stateFromGstin(g);
    if (st && GST_STATES[st]) f.set("stateCode", st);
  };
  const lockOpening = openingLocked || isWalkin;

  return (
    <FormGrid>
      <TextField className="sm:col-span-2" label="Customer name" name={`${idPrefix}-name`} required value={f.values.name} onChange={(e) => f.set("name", e.target.value)} error={f.errors.name} />
      <TextField label="Contact number" name={`${idPrefix}-phone`} required inputMode="tel" value={f.values.phone} onChange={(e) => f.set("phone", e.target.value)} error={f.errors.phone} />
      <TextField
        label="GSTIN"
        name={`${idPrefix}-gstin`}
        maxLength={15}
        inputClassName="uppercase"
        value={f.values.gstin}
        onChange={(e) => onGstin(e.target.value)}
        error={f.errors.gstin}
        hint="State fills in automatically"
      />
      <SelectField
        label="State"
        name={`${idPrefix}-state`}
        required
        placeholder="Select state"
        options={STATE_OPTIONS}
        value={f.values.stateCode}
        onChange={(e) => f.set("stateCode", e.target.value)}
        error={f.errors.stateCode}
        hint={f.values.gstin ? undefined : "Defaults to the company's state"}
      />
      <TextAreaField className="sm:col-span-2" label="Address" name={`${idPrefix}-address`} value={f.values.address} onChange={(e) => f.set("address", e.target.value)} error={f.errors.address} />
      <TextField
        label="Opening balance (₹)"
        name={`${idPrefix}-ob`}
        inputMode="decimal"
        inputClassName="text-right"
        disabled={lockOpening}
        value={f.values.openingBalance}
        onChange={(e) => f.set("openingBalance", e.target.value)}
        error={f.errors.openingBalance}
        hint={isWalkin ? "Walk-in Customer has no balance" : openingLocked ? "Locked — the customer already has bills or receipts" : undefined}
      />
      <SelectField
        label="Dr / Cr"
        name={`${idPrefix}-obtype`}
        disabled={lockOpening}
        options={[
          { value: "DR", label: "Dr — customer owes us" },
          { value: "CR", label: "Cr — advance with us" },
        ]}
        value={f.values.openingType}
        onChange={(e) => f.set("openingType", e.target.value as "DR" | "CR")}
        error={f.errors.openingType}
      />
      <TextField
        label="Opening date"
        name={`${idPrefix}-obdate`}
        type="date"
        disabled={lockOpening}
        value={f.values.openingDate}
        onChange={(e) => f.set("openingDate", e.target.value)}
        error={f.errors.openingDate}
      />
      {showActive && (
        <div className="flex items-end pb-1">
          <Switch
            checked={f.values.isActive}
            onChange={(v) => f.set("isActive", v)}
            label="Active"
            disabled={isWalkin}
            description={isWalkin ? "System customer — always active" : usedNote}
          />
        </div>
      )}
    </FormGrid>
  );
}
