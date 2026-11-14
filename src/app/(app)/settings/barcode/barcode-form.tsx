"use client";

import { BarcodeSvg } from "@/components/barcode";
import { useForm } from "@/components/forms/use-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, FormError, FormGrid, SelectField, TextField } from "@/components/ui/fields";
import { barcodeSettingsSchema, formatBarcode, LABEL_FIELDS } from "@/lib/validation/masters";
import { saveBarcodeSettings } from "./actions";

type Values = {
  prefix: string;
  suffix: string;
  digits: string;
  startNumber: string;
  labelSize: "50x25" | "38x25";
  labelFields: string[];
  labelsPerRow: string;
};

export function BarcodeForm({
  initial,
  lastIssued,
  categories,
  companyName,
}: {
  initial: Values;
  lastIssued: number;
  companyName: string;
  categories: { key: string; label: string; hidden: boolean }[];
}) {
  const f = useForm<Values>(initial);
  const v = f.values;

  const digits = Math.min(Math.max(Number(v.digits) || 0, 1), 12);
  const start = Math.max(Number(v.startNumber) || 1, 1);
  const nextNumber = Math.max(start, lastIssued + 1);
  const fmt = { prefix: v.prefix.toUpperCase(), suffix: v.suffix.toUpperCase(), digits };
  const first = formatBarcode(fmt, nextNumber);
  const overflow = String(nextNumber).length > digits;

  // Show configured category names, never "Category 1"; skip hidden categories.
  const fieldOptions = LABEL_FIELDS.flatMap((fld) => {
    const cat = categories.find((c) => c.key === fld.key);
    if (cat) return cat.hidden ? [] : [{ key: fld.key, label: cat.label }];
    return [{ key: fld.key, label: fld.label }];
  });
  const toggleField = (key: string, on: boolean) =>
    f.set("labelFields", on ? [...v.labelFields, key] : v.labelFields.filter((k) => k !== key));

  const sample: Record<string, string> = {
    itemName: "Cotton Shirt Full Sleeve",
    mrp: "MRP ₹1,299.00",
    rsp: "RSP ₹999.00",
    cat1: "Slim Fit",
    cat2: "Navy",
    cat3: "L",
    cat4: "Men",
  };
  const has = (k: string) => v.labelFields.includes(k);
  const catLine = ["cat1", "cat2", "cat3", "cat4"].filter((k) => has(k) && fieldOptions.some((o) => o.key === k)).map((k) => sample[k]);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        f.submit(barcodeSettingsSchema, saveBarcodeSettings);
      }}
      className="grid gap-4 lg:grid-cols-[1fr_380px]"
    >
      <div className="space-y-4">
        <Card>
          <CardHeader title="Barcode number format" />
          <CardBody>
            <FormError>{f.errors._form}</FormError>
            <FormGrid cols={2}>
              <TextField label="Prefix" name="prefix" maxLength={10} inputClassName="uppercase" value={v.prefix} onChange={(e) => f.set("prefix", e.target.value.toUpperCase())} error={f.errors.prefix} hint="Optional, e.g. CB" />
              <TextField label="Suffix" name="suffix" maxLength={10} inputClassName="uppercase" value={v.suffix} onChange={(e) => f.set("suffix", e.target.value.toUpperCase())} error={f.errors.suffix} hint="Optional" />
              <TextField label="Digits in running number" name="digits" required inputMode="numeric" value={v.digits} onChange={(e) => f.set("digits", e.target.value.replace(/\D/g, ""))} error={f.errors.digits} hint="3 to 12" />
              <TextField label="Starting number" name="startNumber" required inputMode="numeric" value={v.startNumber} onChange={(e) => f.set("startNumber", e.target.value.replace(/\D/g, ""))} error={f.errors.startNumber} />
            </FormGrid>
            <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm">
              <p>
                Symbology: <strong>Code 128</strong>. {lastIssued > 0 ? <>Numbers issued so far: <strong>{lastIssued.toLocaleString("en-IN")}</strong>. </> : "No barcodes issued yet. "}
                Next barcode: <strong className="font-mono">{first}</strong>
              </p>
              {lastIssued > 0 && start <= lastIssued && (
                <p className="mt-1 text-xs text-warning">Numbers up to {lastIssued} are already used, so numbering continues from {lastIssued + 1}. Numbers are never reused.</p>
              )}
              {overflow && <p className="mt-1 text-xs text-danger">The next number doesn&apos;t fit in {digits} digits — increase the digits.</p>}
              {lastIssued > 0 && <p className="mt-1 text-xs text-muted">Changing the prefix, suffix or digits only affects new barcodes.</p>}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Label template" />
          <CardBody>
            <FormGrid cols={2}>
              <SelectField
                label="Label size"
                name="labelSize"
                options={[
                  { value: "50x25", label: "50 × 25 mm" },
                  { value: "38x25", label: "38 × 25 mm" },
                ]}
                value={v.labelSize}
                onChange={(e) => f.set("labelSize", e.target.value as Values["labelSize"])}
              />
              <TextField label="Labels per row" name="labelsPerRow" required inputMode="numeric" value={v.labelsPerRow} onChange={(e) => f.set("labelsPerRow", e.target.value.replace(/\D/g, ""))} error={f.errors.labelsPerRow} hint="1 for single-roll thermal printers" />
            </FormGrid>
            <fieldset className="mt-4">
              <legend className="mb-2 text-[13px] font-medium text-slate-700">Fields to print</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {fieldOptions.map((o) => (
                  <Checkbox key={o.key} label={o.label} checked={has(o.key)} onChange={(on) => toggleField(o.key, on)} />
                ))}
              </div>
              {f.errors.labelFields && <p className="mt-1 text-xs text-danger">{f.errors.labelFields}</p>}
            </fieldset>
            <p className="mt-3 text-xs text-muted">The company / store name from Company Profile is printed at the top of every label.</p>
          </CardBody>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" disabled={f.pending}>
            {f.pending ? "Saving…" : "Save barcode settings"}
          </Button>
        </div>
      </div>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader title="Live preview" />
        <CardBody className="flex flex-col items-center gap-3">
          <div
            className="flex flex-col items-center justify-center overflow-hidden rounded border border-slate-300 bg-white px-2 py-1 text-center leading-tight text-black shadow-sm"
            style={{ width: v.labelSize === "50x25" ? 250 : 190, height: 125 }}
          >
            <p className="w-full truncate text-[9px] font-semibold uppercase tracking-wide">{companyName}</p>
            {has("itemName") && <p className="w-full truncate text-[10px] font-medium">{sample.itemName}</p>}
            {catLine.length > 0 && <p className="w-full truncate text-[9px]">{catLine.join(" · ")}</p>}
            {!overflow && <BarcodeSvg value={first} height={34} width={v.labelSize === "50x25" ? 1.3 : 1} className="max-w-full" />}
            {has("barcodeText") && <p className="font-mono text-[10px] tracking-wider">{first}</p>}
            <p className="text-[10px] font-semibold">{[has("mrp") && sample.mrp, has("rsp") && sample.rsp].filter(Boolean).join("  ")}</p>
          </div>
          <p className="text-xs text-muted">Approximate; actual print uses exact mm sizes.</p>
        </CardBody>
      </Card>
    </form>
  );
}
