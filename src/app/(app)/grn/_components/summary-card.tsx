"use client";

import { Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/label";
import type { GrnCalc, TaxType } from "@/lib/grn-calc";
import { formatAmount, formatINR } from "@/lib/india";
import { fromPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { MAX_OTHER_CHARGES, type GrnSummaryForm, type OtherChargeForm } from "@/lib/validation/grn";

const amt = (p: number) => formatAmount(fromPaise(p));
/** Signed rupees: negatives as "−1,250.00" (true minus sign). */
const signed = (p: number) => (p < 0 ? `−${amt(-p)}` : amt(p));
const newUid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** % / ₹ switch shared by Discount and GST. */
function ModeToggle({
  value,
  onChange,
  disabled,
  label,
}: {
  value: "PERCENT" | "AMOUNT";
  onChange: (v: "PERCENT" | "AMOUNT") => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded border border-border text-xs" role="group" aria-label={label}>
      {(["PERCENT", "AMOUNT"] as const).map((t) => (
        <button
          key={t}
          type="button"
          disabled={disabled}
          aria-pressed={value === t}
          onClick={() => onChange(t)}
          className={cn("px-2 py-0.5", value === t ? "bg-primary text-white" : "bg-surface hover:bg-slate-50")}
        >
          {t === "PERCENT" ? "%" : "₹"}
        </button>
      ))}
    </span>
  );
}

/** CARD 4 — Remarks (left) and Summary (right ~400px). */
export function SummaryCard({
  values,
  onChange,
  calc,
  taxType,
  errors,
  disabled,
  netMismatch,
  supplierUnregistered,
}: {
  values: GrnSummaryForm;
  onChange: (patch: Partial<GrnSummaryForm>) => void;
  calc: GrnCalc;
  taxType: TaxType;
  errors: Record<string, string>;
  disabled: boolean;
  /** Highlight Net Payable (it doesn't match Invoice Value after a Save GRN attempt). */
  netMismatch: boolean;
  supplierUnregistered: boolean;
}) {
  const setOther = (uid: string, patch: Partial<OtherChargeForm>) =>
    onChange({ otherCharges: values.otherCharges.map((o) => (o.uid === uid ? { ...o, ...patch } : o)) });
  const addOther = () => {
    const uid = newUid();
    onChange({ otherCharges: [...values.otherCharges, { uid, description: "", amount: "" }] });
    setTimeout(() => document.getElementById(`sum-other-desc-${uid}`)?.focus(), 0);
  };

  const numInput = (props: React.ComponentProps<typeof Input>) => (
    <Input inputMode="decimal" autoComplete="off" disabled={disabled} {...props} className={cn("h-8 w-28 text-right tabular-nums", props.className)} />
  );

  const row = (label: React.ReactNode, value: React.ReactNode, cls?: string) => (
    <div className={cn("flex items-center justify-between gap-3 py-1.5", cls)}>
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      <Card>
        <CardHeader title="Remarks" />
        <CardBody>
          <textarea
            id="sum-remarks"
            rows={5}
            maxLength={1000}
            disabled={disabled}
            value={values.remarks}
            onChange={(e) => onChange({ remarks: e.target.value })}
            placeholder="Notes about this receipt (damages, short supply, scheme, …)"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50"
          />
          <p className="mt-1 text-right text-xs text-muted">{values.remarks.length}/1000</p>
          <FieldError>{errors.remarks}</FieldError>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Summary" />
        <CardBody className="divide-y divide-border py-2">
          {row(`Gross Amount (${calc.qty.toLocaleString("en-IN")} pcs)`, amt(calc.gross))}

          {/* Discount */}
          <div className="py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm text-slate-600">
                <label htmlFor="sum-discount">Discount</label>
                <ModeToggle label="Discount type" value={values.discountType} onChange={(v) => onChange({ discountType: v })} disabled={disabled} />
              </span>
              {numInput({
                id: "sum-discount",
                value: values.discountValue,
                placeholder: values.discountType === "PERCENT" ? "0 %" : "0.00",
                invalid: !!errors.discountValue || calc.discountExceedsGross,
                onChange: (e) => onChange({ discountValue: e.target.value.replace(/[^\d.]/g, "") }),
              })}
            </div>
            {calc.discount > 0 && <p className="mt-1 text-right text-xs tabular-nums text-muted">− {amt(calc.discount)} split across lines by amount</p>}
            <FieldError>{errors.discountValue ?? (calc.discountExceedsGross ? "Discount can't be more than the gross amount" : undefined)}</FieldError>
          </div>

          {row("Taxable Value", amt(calc.taxable), "font-medium")}

          {/* GST — entered for the whole bill */}
          <div className="py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm text-slate-600">
                <label htmlFor="sum-gst">GST</label>
                <ModeToggle label="GST type" value={values.gstMode} onChange={(v) => onChange({ gstMode: v })} disabled={disabled} />
              </span>
              {numInput({
                id: "sum-gst",
                value: values.gstValue,
                placeholder: values.gstMode === "PERCENT" ? "0 %" : "0.00",
                invalid: !!errors.gstValue,
                onChange: (e) => onChange({ gstValue: e.target.value.replace(/[^\d.]/g, "") }),
              })}
            </div>
            {calc.gst > 0 ? (
              <div className="mt-1 space-y-0.5 text-right text-xs tabular-nums text-muted">
                {values.gstMode === "PERCENT" && <p>+ {amt(calc.gst)}</p>}
                {taxType === "INTRA" ? (
                  <>
                    <p>CGST (50%) {amt(calc.cgst)}</p>
                    <p>SGST (50%) {amt(calc.sgst)}</p>
                  </>
                ) : (
                  <p>IGST (100%) {amt(calc.igst)}</p>
                )}
              </div>
            ) : (
              supplierUnregistered && <p className="mt-1 text-right text-xs text-muted">Supplier has no GSTIN — GST is usually 0</p>
            )}
            <FieldError>{errors.gstValue}</FieldError>
          </div>

          {/* Transport — plain amount, no GST */}
          <div className="py-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="sum-transport" className="text-sm text-slate-600">
                Transport / Freight
              </label>
              {numInput({
                id: "sum-transport",
                value: values.transport,
                placeholder: "0.00",
                invalid: !!errors.transport,
                onChange: (e) => onChange({ transport: e.target.value.replace(/[^\d.]/g, "") }),
              })}
            </div>
            <FieldError>{errors.transport}</FieldError>
          </div>

          {/* Other charges — any number of rows, may be negative */}
          <div className="py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-slate-600">Other Charges</span>
              <span className={cn("text-sm tabular-nums", calc.othersTotal < 0 && "text-danger")}>{signed(calc.othersTotal)}</span>
            </div>
            {values.otherCharges.map((o, i) => {
              const amountNum = Number(o.amount.replace(/,/g, ""));
              return (
                <div key={o.uid} className="mt-1.5">
                  <div className="flex items-center gap-1.5">
                    <Input
                      id={`sum-other-desc-${o.uid}`}
                      aria-label={`Other charge ${i + 1} description`}
                      placeholder="Description"
                      maxLength={100}
                      disabled={disabled}
                      invalid={!!errors[`otherCharges.${i}.description`]}
                      value={o.description}
                      onChange={(e) => setOther(o.uid, { description: e.target.value })}
                      className="h-8 flex-1"
                    />
                    {numInput({
                      id: `sum-other-amt-${o.uid}`,
                      "aria-label": `Other charge ${i + 1} amount`,
                      placeholder: "0.00",
                      value: o.amount,
                      invalid: !!errors[`otherCharges.${i}.amount`],
                      className: cn(amountNum < 0 && "text-danger"),
                      onChange: (e) => setOther(o.uid, { amount: e.target.value.replace(/[^\d.-]/g, "").replace(/(?!^)-/g, "") }),
                    })}
                    {!disabled && (
                      <button
                        type="button"
                        aria-label={`Remove other charge ${i + 1}`}
                        onClick={() => onChange({ otherCharges: values.otherCharges.filter((x) => x.uid !== o.uid) })}
                        className="rounded p-1 text-muted hover:bg-slate-100 hover:text-danger"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                  <FieldError>{errors[`otherCharges.${i}.description`] ?? errors[`otherCharges.${i}.amount`]}</FieldError>
                </div>
              );
            })}
            {!disabled && values.otherCharges.length < MAX_OTHER_CHARGES && (
              <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-2 text-primary" onClick={addOther}>
                <Plus /> Add charge
              </Button>
            )}
            <p className="mt-0.5 text-xs text-muted">Use a minus amount for a vendor discount given after the main discount.</p>
          </div>

          {/* Round off */}
          <div className="py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm text-slate-600">
                <label htmlFor="sum-roundOff">Round Off</label>
                {values.roundOffManual ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange({ roundOffManual: false })}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                    title="Go back to automatic rounding"
                  >
                    <RotateCcw className="size-3" /> Auto
                  </button>
                ) : (
                  <Chip className="text-[10px]">auto</Chip>
                )}
              </span>
              {numInput({
                id: "sum-roundOff",
                value: values.roundOffManual ? values.roundOff : fromPaise(calc.autoRoundOff),
                invalid: !!errors.roundOff,
                onChange: (e) => onChange({ roundOffManual: true, roundOff: e.target.value.replace(/[^\d.-]/g, "") }),
              })}
            </div>
            <FieldError>{errors.roundOff}</FieldError>
          </div>

          <div
            id="sum-net"
            className={cn("-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-3", netMismatch && "bg-danger-soft ring-2 ring-danger")}
          >
            <span className="text-base font-semibold">Net Payable</span>
            <span className={cn("text-2xl font-bold tabular-nums", netMismatch || calc.net < 0 ? "text-danger" : "text-primary")}>
              {calc.net < 0 ? `−${formatINR(fromPaise(-calc.net))}` : formatINR(fromPaise(calc.net))}
            </span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
