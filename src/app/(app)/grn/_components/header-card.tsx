"use client";

import { Plus } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { FieldError, Label } from "@/components/ui/label";
import { useState } from "react";
import { formatAmount, stateName } from "@/lib/india";
import { MONEY_RE } from "@/lib/money";
import type { GrnHeaderForm } from "@/lib/validation/grn";
import type { EntryMasters } from "../_lib/load";

type Props = {
  values: GrnHeaderForm;
  set: <K extends keyof GrnHeaderForm>(k: K, v: GrnHeaderForm[K]) => void;
  touch: (k: keyof GrnHeaderForm) => void;
  errors: Partial<Record<keyof GrnHeaderForm, string>>;
  masters: EntryMasters;
  grnNo: string | null;
  disabled: boolean;
  onQuickAddSupplier?: (typed: string) => void;
  autoFocusSupplier?: boolean;
  /** Highlight Invoice Value after a Save GRN attempt where it didn't match Net Payable. */
  invoiceMismatch?: boolean;
};

const selectCls =
  "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-muted";

/** ₹ amount input: plain digits while typing, Indian grouping (1,25,000.00) when not focused. */
function MoneyInput({
  id,
  value,
  onChange,
  onBlur,
  disabled,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const raw = value.replace(/,/g, "");
  const shown = !focused && MONEY_RE.test(raw) ? formatAmount(raw) : value;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">₹</span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        invalid={invalid}
        className="pl-7 text-right tabular-nums"
        value={shown}
        onFocus={(e) => {
          setFocused(true);
          // The text changes from "7,500.00" to "7500.00" on focus; select it after that re-render so typing replaces it.
          const el = e.currentTarget;
          setTimeout(() => el.select(), 0);
        }}
        onBlur={() => {
          setFocused(false);
          onBlur();
        }}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
      />
    </div>
  );
}

export function HeaderCard({ values, set, touch, errors, masters, grnNo, disabled, onQuickAddSupplier, autoFocusSupplier, invoiceMismatch = false }: Props) {
  const supplier = masters.suppliers.find((s) => String(s.id) === values.supplierId);
  const location = masters.locations.find((l) => String(l.id) === values.locationId);
  const taxType = supplier && location ? (supplier.stateCode === location.stateCode ? "INTRA" : "INTER") : null;

  const field = (k: keyof GrnHeaderForm, label: string, required: boolean, control: React.ReactNode, extra?: React.ReactNode, span = 1) => (
    <div className={span === 2 ? "sm:col-span-2" : undefined}>
      <Label htmlFor={`grn-${k}`} required={required}>
        {label}
      </Label>
      {control}
      {errors[k] ? <FieldError>{errors[k]}</FieldError> : extra}
    </div>
  );

  const dateInput = (k: "grnDate" | "invoiceDate" | "transportDate") => (
    <Input
      id={`grn-${k}`}
      type="date"
      max={masters.today}
      value={values[k]}
      disabled={disabled}
      invalid={!!errors[k]}
      onChange={(e) => set(k, e.target.value)}
      onBlur={() => touch(k)}
    />
  );

  return (
    <Card>
      <CardHeader
        title="GRN Details"
        actions={
          taxType && (
            <Chip tone={taxType === "INTRA" ? "primary" : "warning"}>{taxType === "INTRA" ? "Intra-state · CGST + SGST" : "Inter-state · IGST"}</Chip>
          )
        }
      />
      <CardBody>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="grn-no">GRN No.</Label>
            <Input id="grn-no" readOnly tabIndex={-1} value={grnNo ?? ""} placeholder="Auto on save" className="bg-slate-50 font-mono" />
          </div>
          {field("grnDate", "GRN Date", true, dateInput("grnDate"))}
          {field(
            "locationId",
            "Receiving Location",
            true,
            <select
              id="grn-locationId"
              className={selectCls}
              value={values.locationId}
              disabled={disabled}
              aria-invalid={!!errors.locationId || undefined}
              onChange={(e) => set("locationId", e.target.value)}
              onBlur={() => touch("locationId")}
            >
              <option value="">Select location</option>
              {masters.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.type === "GODOWN" ? " (Godown)" : ""}
                </option>
              ))}
            </select>,
            location && <p className="mt-1 text-xs text-muted">{stateName(location.stateCode)}</p>,
          )}
          <div className="hidden lg:block" />

          {field(
            "supplierId",
            "Supplier",
            true,
            <Combobox
              id="grn-supplierId"
              value={values.supplierId}
              disabled={disabled}
              autoFocus={autoFocusSupplier}
              invalid={!!errors.supplierId}
              placeholder="Search supplier name or GSTIN"
              options={masters.suppliers.map((s) => ({
                value: String(s.id),
                label: s.name,
                hint: [s.gstin, stateName(s.stateCode)].filter(Boolean).join(" · "),
              }))}
              onChange={(v) => {
                set("supplierId", v);
                touch("supplierId");
              }}
              footer={
                onQuickAddSupplier
                  ? (close) => (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft"
                        onClick={() => {
                          const typed = (document.getElementById("grn-supplierId") as HTMLInputElement | null)?.value ?? "";
                          close();
                          onQuickAddSupplier(supplier && typed === supplier.name ? "" : typed);
                        }}
                      >
                        <Plus className="size-4" /> Add new supplier
                      </button>
                    )
                  : undefined
              }
            />,
            supplier ? (
              <p className="mt-1 truncate text-xs text-muted">
                {supplier.gstin ? <span className="font-mono">{supplier.gstin}</span> : "Unregistered (no GSTIN)"} · {stateName(supplier.stateCode)}
              </p>
            ) : null,
            2,
          )}
          {field(
            "invoiceNo",
            "Supplier Invoice No.",
            true,
            <Input
              id="grn-invoiceNo"
              value={values.invoiceNo}
              disabled={disabled}
              invalid={!!errors.invoiceNo}
              maxLength={60}
              autoComplete="off"
              onChange={(e) => set("invoiceNo", e.target.value)}
              onBlur={() => touch("invoiceNo")}
            />,
          )}
          {field("invoiceDate", "Invoice Date", true, dateInput("invoiceDate"))}
          {field(
            "invoiceValue",
            "Invoice Value (₹)",
            true,
            <MoneyInput
              id="grn-invoiceValue"
              value={values.invoiceValue}
              disabled={disabled}
              invalid={!!errors.invoiceValue || invoiceMismatch}
              onChange={(v) => set("invoiceValue", v)}
              onBlur={() => touch("invoiceValue")}
            />,
            <p className="mt-1 text-xs text-muted">Total printed on the supplier&apos;s bill</p>,
          )}

          {field(
            "transportId",
            "Transport",
            false,
            <Combobox
              id="grn-transportId"
              value={values.transportId}
              disabled={disabled}
              invalid={!!errors.transportId}
              placeholder="Select transporter"
              options={masters.transports.map((t) => ({ value: String(t.id), label: t.name }))}
              onChange={(v) => {
                set("transportId", v);
                touch("transportId");
              }}
            />,
          )}
          {field(
            "lrNo",
            "LR / Docket No.",
            false,
            <Input
              id="grn-lrNo"
              value={values.lrNo}
              disabled={disabled}
              invalid={!!errors.lrNo}
              maxLength={60}
              autoComplete="off"
              onChange={(e) => set("lrNo", e.target.value)}
              onBlur={() => touch("lrNo")}
            />,
          )}
          {field("transportDate", "Transport Date", false, dateInput("transportDate"))}
        </div>
      </CardBody>
    </Card>
  );
}
